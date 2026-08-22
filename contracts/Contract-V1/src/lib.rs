#![no_std]

//! StellarStream - Real-time asset streaming on Stellar
//!
//! Genesis contract (V1) for the StellarStream protocol.
//!
//! Core concepts:
//! - Continuous token streaming from sender to receiver
//! - Linear / exponential vesting based on elapsed time
//! - Real-time withdrawals of unlocked amounts
//! - Cancellation support with automatic refunds
//! - Role-based access control, pause/resume, and OFAC-style address restriction
//! - Re-entrancy safe withdrawals (checks-effects-interactions + temporary lock)
//! - Configurable protocol fee collected to a treasury on stream creation
//!
//! # Protocol fee
//!
//! Creating a stream charges a protocol fee **on top of** the streamed amount.
//! A stream of 1_000 tokens at 100 bps costs the sender 1_010 tokens: 1_000
//! remain streamable to the receiver and 10 go to the treasury. The stream's
//! `total_amount` is never reduced by the fee, so a receiver is always owed
//! exactly what the stream says.
//!
//! - The rate is stored in basis points, where 10_000 bps is 100%
//!   ([`BPS_DENOMINATOR`]), and is capped at [`MAX_FEE_BPS`] (1_000 bps = 10%).
//!   The cap is enforced on write, so an out-of-range rate can never be
//!   observed by `create_stream`.
//! - The fee is `amount * fee_bps / 10_000`, rounded down, computed with
//!   checked multiplication so a large amount reports [`Error::Overflow`]
//!   instead of wrapping.
//! - A rate of `0` disables collection: no token transfer is attempted and no
//!   treasury is required.
//! - With a non-zero rate and no treasury configured, `create_stream` fails
//!   with [`Error::TreasuryNotSet`] rather than quietly skipping the fee.
//! - Collection and stream creation share one invocation, so they succeed or
//!   fail together. A sender who cannot cover `amount + fee` creates no stream.
//! - [`StellarStreamContract::set_protocol_fee`] and
//!   [`StellarStreamContract::set_treasury_address`] require [`ROLE_TREASURY`]
//!   or [`ROLE_ADMIN`].
//!
//! Streams created by multi-signature proposal execution are not charged: the
//! fee transfer debits the sender, and proposal execution runs under the
//! approvers' authorization rather than the sender's.
//! - Configurable protocol fee collected to a treasury on stream creation
//!
//! # Protocol fees
//!
//! The protocol charges a fee, expressed in basis points, every time a stream
//! is created through [`StellarStreamContract::create_stream`].
//!
//! The fee is charged **on top of** the stream amount, never taken out of it.
//! A 1_000_000-unit stream at 100 bps (1%) leaves the receiver entitled to the
//! full 1_000_000 and moves a further 10_000 to the treasury, so the sender
//! parts with 1_010_000 in total. This keeps `total_amount` a promise to the
//! receiver rather than a number the protocol quietly shaves.
//!
//! Both transfers happen inside one invocation. If the sender cannot cover
//! `amount + fee`, the token transfer traps and the stream creation is rolled
//! back with it — there is no state in which a stream exists but its fee went
//! uncollected.
//!
//! The rate is capped at [`MAX_FEE_BPS`] (10%) at the point it is written, so
//! an out-of-range rate can never reach stream creation. A rate of `0` is
//! valid and short-circuits before any token call. Fee settings are managed by
//! accounts holding [`ROLE_TREASURY`] or [`ROLE_ADMIN`] via
//! [`StellarStreamContract::set_protocol_fee`] and
//! [`StellarStreamContract::set_treasury_address`]; callers can preview the
//! charge with [`StellarStreamContract::calculate_protocol_fee`].
//!
//! Streams created by multi-signature proposal execution are not charged,
//! because that path creates the stream under the approvers' authorization
//! rather than the sender's and so cannot move the sender's tokens.
//!
//! See `contracts/Contract-V1/README.md` for the full specification.

pub mod math;

#[cfg(test)]
mod bench_test;

use soroban_sdk::{
    contract, contractclient, contracterror, contractimpl, contracttype, symbol_short, Address,
    Env, Map, String, Symbol, Vec,
};

// ---------------------------------------------------------------------------
// Storage keys
// ---------------------------------------------------------------------------
const ADMIN: Symbol = symbol_short!("ADMIN");
const PAUSED: Symbol = symbol_short!("PAUSED");
const NEXTID: Symbol = symbol_short!("NEXTID");
const ROLES: Symbol = symbol_short!("ROLES");
const RESTRICT: Symbol = symbol_short!("RESTRICT");
const LOCK: Symbol = symbol_short!("LOCK");
const STREAMS: Symbol = symbol_short!("STREAMS");
const USTREAMS: Symbol = symbol_short!("USTREAMS");
const PROPOSALS: Symbol = symbol_short!("PROPOSALS");
const METADATA: Symbol = symbol_short!("METADATA");
const FEEBPS: Symbol = symbol_short!("FEEBPS");
const TREASURY: Symbol = symbol_short!("TREASURY");
const NEXTPROPOSAL: Symbol = symbol_short!("NEXTPROP");
const HISTORY: Symbol = symbol_short!("HISTORY");

// Stream state
pub const STATE_ACTIVE: u32 = 0;
pub const STATE_PAUSED: u32 = 1;
pub const STATE_CLOSED: u32 = 2;

// Vesting curve
pub const CURVE_LINEAR: u32 = 0;
pub const CURVE_EXP: u32 = 1;
pub const CURVE_MILESTONE: u32 = 2;

// Protocol fee
/// Denominator for basis-point math: 10_000 bps == 100%.
pub const BPS_DENOMINATOR: i128 = 10_000;
/// Hard ceiling on the protocol fee: 1_000 bps == 10%.
pub const MAX_FEE_BPS: u32 = 1_000;

// Roles
pub const ROLE_ADMIN: u32 = 0;
pub const ROLE_PAUSER: u32 = 1;
pub const ROLE_TREASURY: u32 = 2;

// ---------------------------------------------------------------------------
// Error definitions
// ---------------------------------------------------------------------------
#[contracterror]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    InvalidTimeRange = 2,
    InvalidAmount = 3,
    StreamNotFound = 4,
    Unauthorized = 5,
    AlreadyCancelled = 6,
    InsufficientBalance = 7,
    AlreadyPaused = 8,
    NotPaused = 9,
    ContractPaused = 10,
    Reentrancy = 11,
    NotAdmin = 12,
    NotPauser = 13,
    StreamPaused = 14,
    WithdrawTooLarge = 15,
    InvalidCurve = 16,
    InvalidRole = 17,
    StreamIsSoulbound = 21,
    AddressRestricted = 22,
    StreamNotPaused = 26,
    Overflow = 27,
    ProposalNotFound = 28,
    ProposalExpired = 29,
    AlreadyApproved = 30,
    ProposalAlreadyExecuted = 31,
    InvalidApprovalThreshold = 32,
    BatchSizeExceeded = 33,
    StreamEnded = 34,
    MetadataLabelTooLong = 35,
    TooManyTags = 36,
    TagTooLong = 37,
    FeeTooHigh = 38,
    TreasuryNotSet = 39,
    StreamEnded = 33,
    MetadataLabelTooLong = 34,
    TooManyTags = 35,
    TagTooLong = 36,
    BatchSizeExceeded = 37,
    InvalidMilestones = 38,
    InvalidMilestonePercentages = 39,
}

// ---------------------------------------------------------------------------
// Data structures
// ---------------------------------------------------------------------------
#[contracttype]
#[derive(Clone)]
pub struct Stream {
    pub id: u64,
    pub sender: Address,
    pub receiver: Address,
    pub token: Address,
    pub total_amount: i128,
    pub start_time: u64,
    pub end_time: u64,
    pub withdrawn_amount: i128,
    pub state: u32,
    pub curve_type: u32,
    pub is_soulbound: bool,
    pub paused_duration: u64,
    pub last_paused_at: u64,
}

// ---------------------------------------------------------------------------
// Stream metadata for categorization (issue #1466)
//
// Metadata lives in its own `METADATA` map keyed by stream id rather than as an
// `Option<StreamMetadata>` field on `Stream`: soroban-sdk 22 cannot convert an
// `Option<T>` whose `T` is a user `#[contracttype]` struct, which makes any
// struct carrying such a field fail to build under `testutils`.
    pub stream_metadata: Option<StreamMetadata>,
    /// Present only when `curve_type == CURVE_MILESTONE`; see [`Milestone`].
    pub milestones: Option<Vec<Milestone>>,
}

/// A single unlock checkpoint in a milestone-vesting schedule.
///
/// Milestone vesting unlocks tokens in discrete steps at fixed timestamps
/// instead of continuously over time. Each milestone's `percentage` is a
/// **cumulative** basis-point share (out of 10,000) of the stream's total
/// amount — not an incremental slice on top of the previous milestone. For
/// example, the schedule `[(3mo, 2500), (6mo, 5000), (12mo, 10000)]` means
/// 25% is unlocked at 3 months, a *total* of 50% at 6 months, and 100% at 12
/// months (not 25% + 25% + 50%).
///
/// A valid schedule must have strictly ascending `timestamp`s, strictly
/// ascending `percentage`s, and a final `percentage` of exactly 10,000 bps.
/// Before the first milestone's timestamp is reached, nothing is unlocked;
/// between two reached milestones, the most recently reached milestone's
/// percentage holds (no partial/gradual unlock in between).
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Milestone {
    /// Ledger timestamp (seconds) at which this checkpoint is reached.
    pub timestamp: u64,
    /// Cumulative basis points (out of 10,000) unlocked once `timestamp` is reached.
    pub percentage: u32,
}

// Stream metadata for categorization (issue #1466)
// ---------------------------------------------------------------------------
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct StreamMetadata {
    pub label: String,
    pub tags: Vec<String>,
    pub external_ref: Option<String>,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct StreamMetadataUpdatedEvent {
    pub stream_id: u64,
    pub sender: Address,
    pub timestamp: u64,
}

/// Emitted when a protocol fee is collected while creating a stream.
#[contracttype]
#[derive(Clone, Debug)]
pub struct ProtocolFeeCollectedEvent {
    /// Stream the fee was charged for.
    pub stream_id: u64,
    /// Account that paid the fee (the stream's sender).
    pub payer: Address,
    /// Treasury the fee was credited to.
    pub treasury: Address,
    /// Token the fee was denominated in (same token as the stream).
    pub token: Address,
    /// Fee actually transferred, in token units.
    pub fee_amount: i128,
    /// Fee rate applied, in basis points.
    pub fee_bps: u32,
}

/// A pending multi-signature stream proposal.
///
/// A proposal holds the parameters of a stream that should be created once a
/// threshold of distinct addresses has approved it. The stream is created
/// automatically (without a separate execute call) the moment the number of
/// approvers reaches `required_approvals`.
#[contracttype]
#[derive(Clone)]
pub struct StreamProposal {
    /// Treasury / source account that will fund the stream.
    pub sender: Address,
    /// Recipient of the stream.
    pub receiver: Address,
    /// Token contract address.
    pub token: Address,
    /// Total stream amount.
    pub total_amount: i128,
    /// Stream start timestamp.
    pub start_time: u64,
    /// Stream end timestamp.
    pub end_time: u64,
    /// Addresses that have approved so far (each may approve only once).
    pub approvers: Vec<Address>,
    /// M-of-N threshold: number of distinct approvals required to execute.
    pub required_approvals: u32,
    /// Timestamp after which the proposal can no longer be approved.
    pub deadline: u64,
    /// Whether the proposal has been executed (stream already created).
    pub executed: bool,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum StreamAction {
    Created,
    Withdrawn(i128),
    Paused,
    Resumed,
    ToppedUp(i128),
    Cancelled,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct StreamEvent {
    pub stream_id: u64,
    pub action: StreamAction,
    pub timestamp: u64,
}

// Minimal token interface used by `withdraw`.
#[contractclient(name = "TokenClient")]
pub trait Token {
    fn transfer(env: Env, from: Address, to: Address, amount: i128);
}

// ---------------------------------------------------------------------------
// Contract
// ---------------------------------------------------------------------------
#[contract]
pub struct StellarStreamContract;

#[contractimpl]
impl StellarStreamContract {
    /// Initialize the contract with an admin address. Idempotency guarded.
    pub fn initialize(env: Env, admin: Address) -> Result<(), Error> {
        admin.require_auth();
        if env.storage().instance().get::<_, Address>(&ADMIN).is_some() {
            return Err(Error::AlreadyInitialized);
        }
        env.storage().instance().set(&ADMIN, &admin);
        env.storage().instance().set(&PAUSED, &false);
        env.storage().instance().set(&NEXTID, &1u64);
        env.storage().instance().set(&NEXTPROPOSAL, &1u64);
        grant_role_internal(env.clone(), &admin, ROLE_ADMIN);
        Ok(())
    }

    /// Create a new stream. Returns the newly allocated stream id.
    pub fn create_stream(
        env: Env,
        sender: Address,
        receiver: Address,
        token: Address,
        total_amount: i128,
        start_time: u64,
        end_time: u64,
        curve_type: u32,
        is_soulbound: bool,
        milestones: Option<Vec<Milestone>>,
    ) -> Result<u64, Error> {
        sender.require_auth();
        let stream_id = create_stream_internal(
            &env,
            &sender,
            &receiver,
            &token,
            total_amount,
            start_time,
            end_time,
            curve_type,
            is_soulbound,
        )?;
        // Charged on top of `total_amount`, so the stream is funded in full and
        // the sender pays `total_amount + fee`. A failure here (an unset
        // treasury, or a sender who cannot cover the fee) reverts the whole
        // invocation, including the stream just created.
        collect_protocol_fee(&env, &sender, &token, stream_id, total_amount)?;
        Ok(stream_id)
            milestones,
        )
    }

    /// Create a multi-signature proposal for a stream.
    ///
    /// The stream is not created immediately. Instead a proposal is stored
    /// which becomes a live stream automatically once `required_approvals`
    /// distinct addresses call [`approve_proposal`]. This lets a DAO treasury
    /// or corporate wallet require multiple signatures before committing to a
    /// payment stream.
    ///
    /// Returns the newly allocated proposal id.
    pub fn create_proposal(
        env: Env,
        sender: Address,
        receiver: Address,
        token: Address,
        total_amount: i128,
        start_time: u64,
        end_time: u64,
        required_approvals: u32,
        deadline: u64,
    ) -> Result<u64, Error> {
        sender.require_auth();
        if is_contract_paused(&env) {
            return Err(Error::ContractPaused);
        }
        if env.storage().instance().get::<_, Address>(&ADMIN).is_none() {
            return Err(Error::Unauthorized);
        }
        if total_amount <= 0 {
            return Err(Error::InvalidAmount);
        }
        if start_time >= end_time {
            return Err(Error::InvalidTimeRange);
        }
        if required_approvals == 0 {
            return Err(Error::InvalidApprovalThreshold);
        }
        if deadline <= env.ledger().timestamp() {
            return Err(Error::ProposalExpired);
        }
        if is_restricted(&env, &sender) || is_restricted(&env, &receiver) {
            return Err(Error::AddressRestricted);
        }

        let mut next = env
            .storage()
            .instance()
            .get::<_, u64>(&NEXTPROPOSAL)
            .unwrap_or(1);
        let id = next;
        next = next.checked_add(1).ok_or(Error::Overflow)?;

        let proposal = StreamProposal {
            sender: sender.clone(),
            receiver: receiver.clone(),
            token,
            total_amount,
            start_time,
            end_time,
            approvers: Vec::new(&env),
            required_approvals,
            deadline,
            executed: false,
        };

        let mut proposals = get_proposals(&env);
        proposals.set(id, proposal);
        env.storage().persistent().set(&PROPOSALS, &proposals);
        env.storage().instance().set(&NEXTPROPOSAL, &next);

        env.events()
            .publish((symbol_short!("proposal"), sender.clone()), id);

        add_user_stream(&env, &sender, id);
        add_user_stream(&env, &receiver, id);

        env.storage().instance().set(&NEXTID, &next);

        // Record history event
        add_history(&env, id, StreamAction::Created);

        Ok(id)
    }

    /// Approve a pending proposal.
    ///
    /// Each address may approve a given proposal at most once. When the number
    /// of distinct approvers reaches `required_approvals`, the proposal is
    /// marked executed and the underlying stream is created immediately.
    pub fn approve_proposal(
        env: Env,
        proposal_id: u64,
        approver: Address,
    ) -> Result<(), Error> {
        approver.require_auth();
        if is_contract_paused(&env) {
            return Err(Error::ContractPaused);
        }

        let mut proposal = get_proposal(&env, proposal_id)?;

        if proposal.executed {
            return Err(Error::ProposalAlreadyExecuted);
        }
        if env.ledger().timestamp() > proposal.deadline {
            return Err(Error::ProposalExpired);
        }
        if proposal.approvers.contains(approver.clone()) {
            return Err(Error::AlreadyApproved);
        }

        proposal.approvers.push_back(approver.clone());
        env.events()
            .publish((symbol_short!("approval"), approver.clone()), proposal_id);

        if proposal.approvers.len() >= proposal.required_approvals {
            let stream_id = create_stream_internal(
                &env,
                &proposal.sender,
                &proposal.receiver,
                &proposal.token,
                proposal.total_amount,
                proposal.start_time,
                proposal.end_time,
                CURVE_LINEAR,
                false,
                None,
            )?;
            proposal.executed = true;
            save_proposal(&env, proposal_id, &proposal);
            env.events()
                .publish((symbol_short!("executed"), proposal.sender.clone()), stream_id);
        } else {
            save_proposal(&env, proposal_id, &proposal);
        }

        Ok(())
    }

    /// Query a proposal by id.
    pub fn get_proposal(env: Env, proposal_id: u64) -> Result<StreamProposal, Error> {
        get_proposal(&env, proposal_id)
    }

    /// Withdraw the currently unlocked amount to the receiver.
    /// Returns the amount withdrawn.
    pub fn withdraw(env: Env, stream_id: u64, receiver: Address) -> Result<i128, Error> {
        receiver.require_auth();

        // Re-entrancy guard (temporary storage lock).
        if env.storage().temporary().get::<_, bool>(&LOCK).unwrap_or(false) {
            return Err(Error::Reentrancy);
        }
        env.storage().temporary().set(&LOCK, &true);

        let result = withdraw_inner(&env, stream_id, &receiver);

        env.storage().temporary().remove(&LOCK);
        result
    }

    /// Cancel a stream. Only the sender may cancel; refunds are implicit because
    /// the receiver can no longer withdraw unlocked funds once the stream is closed.
    pub fn cancel_stream(env: Env, stream_id: u64, sender: Address) -> Result<(), Error> {
        sender.require_auth();
        let mut stream = get_stream(&env, stream_id)?;
        if stream.sender != sender {
            return Err(Error::Unauthorized);
        }
        if stream.state == STATE_CLOSED {
            return Err(Error::AlreadyCancelled);
        }
        stream.state = STATE_CLOSED;
        save_stream(&env, &stream);
        // Record history event
        add_history(&env, stream_id, StreamAction::Cancelled);
        Ok(())
    }

    /// Pause an active stream. Only the sender may pause.
    pub fn pause_stream(env: Env, stream_id: u64, caller: Address) -> Result<(), Error> {
        caller.require_auth();
        let mut stream = get_stream(&env, stream_id)?;
        if stream.sender != caller {
            return Err(Error::Unauthorized);
        }
        if stream.state == STATE_PAUSED {
            return Err(Error::AlreadyPaused);
        }
        if stream.state == STATE_CLOSED {
            return Err(Error::AlreadyCancelled);
        }
        stream.state = STATE_PAUSED;
        stream.last_paused_at = env.ledger().timestamp();
        save_stream(&env, &stream);
        // Record history event
        add_history(&env, stream_id, StreamAction::Paused);
        Ok(())
    }

    /// Resume a paused stream. Only the sender may resume.
    pub fn resume_stream(env: Env, stream_id: u64, caller: Address) -> Result<(), Error> {
        caller.require_auth();
        let mut stream = get_stream(&env, stream_id)?;
        if stream.sender != caller {
            return Err(Error::Unauthorized);
        }
        if stream.state != STATE_PAUSED {
            return Err(Error::StreamNotPaused);
        }
        let now = env.ledger().timestamp();
        if stream.last_paused_at > 0 && now > stream.last_paused_at {
            stream.paused_duration = stream
                .paused_duration
                .checked_add(now - stream.last_paused_at)
                .ok_or(Error::Overflow)?;
        }
        stream.state = STATE_ACTIVE;
        stream.last_paused_at = 0;
        save_stream(&env, &stream);
        // Record history event
        add_history(&env, stream_id, StreamAction::Resumed);
        Ok(())
    }

    /// Query a stream by id.
    pub fn get_stream(env: Env, stream_id: u64) -> Result<Stream, Error> {
        get_stream(&env, stream_id)
    }

    /// Calculate the total unlocked amount for a stream at the current ledger time.
    pub fn get_unlocked_amount(env: Env, stream_id: u64) -> Result<i128, Error> {
        let stream = get_stream(&env, stream_id)?;
        Ok(unlocked_amount(&env, &stream))
    }

    /// Calculate the currently withdrawable amount for a stream.
    pub fn get_withdrawable_amount(env: Env, stream_id: u64) -> Result<i128, Error> {
        let stream = get_stream(&env, stream_id)?;
        Ok(withdrawable_amount(&env, &stream))
    }

    pub fn get_time_remaining_seconds(env: Env, stream_id: u64) -> Result<u64, Error> {
        let stream = get_stream(&env, stream_id)?;

        if stream.state == STATE_CLOSED {
            return Ok(0);
        }

        let current_time = env.ledger().timestamp();
        let mut effective_time = current_time;

        if stream.state == STATE_PAUSED {
            effective_time = stream.last_paused_at;
        }

        let adjusted_end = stream.end_time + stream.paused_duration;

        if effective_time >= adjusted_end {
            Ok(0)
        } else {
            Ok(adjusted_end - effective_time)
        }
    }

    pub fn get_time_remaining_days(env: Env, stream_id: u64) -> Result<u64, Error> {
        let seconds = Self::get_time_remaining_seconds(env.clone(), stream_id)?;
        Ok(seconds / 86400)
    }

    pub fn get_completion_percentage(env: Env, stream_id: u64) -> Result<u32, Error> {
        let stream = get_stream(&env, stream_id)?;

        let current_time = env.ledger().timestamp();
        let mut effective_time = current_time;

        if stream.state == STATE_PAUSED {
            effective_time = stream.last_paused_at;
        }

        let adjusted_end = stream.end_time + stream.paused_duration;

        if effective_time >= adjusted_end || stream.state == STATE_CLOSED {
            return Ok(10000);
        }

        if effective_time <= stream.start_time {
            return Ok(0);
        }

        let elapsed = effective_time - stream.start_time;
        let total_duration = adjusted_end - stream.start_time;

        if total_duration == 0 {
            return Ok(10000);
        }

        let percentage = (elapsed as u128 * 10000) / (total_duration as u128);
        Ok(percentage as u32)
    }

    /// Return the list of stream ids associated with a user (as sender or receiver).
    pub fn get_user_streams(env: Env, user: Address) -> Vec<u64> {
        get_user_streams(&env, &user)
    }

    // ------------------------- Protocol fee -------------------------

    /// Set the protocol fee charged on stream creation, in basis points.
    ///
    /// Requires the caller to hold [`ROLE_TREASURY`] or [`ROLE_ADMIN`]. The fee
    /// is capped at [`MAX_FEE_BPS`] (1_000 bps = 10%); anything above that is
    /// rejected with [`Error::FeeTooHigh`] so an out-of-range rate can never
    /// reach `create_stream`. Passing `0` disables fee collection entirely.
    pub fn set_protocol_fee(
        env: Env,
        treasury_manager: Address,
        fee_bps: u32,
    ) -> Result<(), Error> {
        treasury_manager.require_auth();
        require_treasury_manager(&env, &treasury_manager)?;
        if fee_bps > MAX_FEE_BPS {
            return Err(Error::FeeTooHigh);
        }
        env.storage().instance().set(&FEEBPS, &fee_bps);
        env.events()
            .publish((symbol_short!("set_fee"), treasury_manager), fee_bps);
        Ok(())
    }

    /// Set the address protocol fees are paid to.
    ///
    /// Requires the caller to hold [`ROLE_TREASURY`] or [`ROLE_ADMIN`]. While no
    /// treasury is set, any non-zero fee makes `create_stream` fail with
    /// [`Error::TreasuryNotSet`] rather than silently skipping collection.
    pub fn set_treasury_address(
        env: Env,
        treasury_manager: Address,
        new_treasury: Address,
    ) -> Result<(), Error> {
        treasury_manager.require_auth();
        require_treasury_manager(&env, &treasury_manager)?;
        env.storage().instance().set(&TREASURY, &new_treasury);
        env.events()
            .publish((symbol_short!("set_treas"), treasury_manager), new_treasury);
        Ok(())
    }

    /// Current protocol fee in basis points (`0` when no fee is configured).
    pub fn get_protocol_fee(env: Env) -> u32 {
        fee_bps(&env)
    }

    /// Current treasury address, or `None` if one has never been set.
    pub fn get_treasury_address(env: Env) -> Option<Address> {
        env.storage().instance().get(&TREASURY)
    }

    /// Fee that `create_stream` would charge on top of `amount`.
    ///
    /// Lets a caller work out the total it must be able to cover
    /// (`amount + fee`) before committing to a stream.
    pub fn calculate_protocol_fee(env: Env, amount: i128) -> Result<i128, Error> {
        protocol_fee_for(&env, amount)
    }

    // ------------------------- Administrative -------------------------

    pub fn grant_role(env: Env, admin: Address, account: Address, role: u32) -> Result<(), Error> {
        admin.require_auth();
        require_admin(&env, &admin)?;
        if role > ROLE_TREASURY {
            return Err(Error::InvalidRole);
        }
        grant_role_internal(env, &account, role);
        Ok(())
    }

    pub fn revoke_role(env: Env, admin: Address, account: Address, role: u32) -> Result<(), Error> {
        admin.require_auth();
        require_admin(&env, &admin)?;
        revoke_role_internal(&env, &account, role);
        Ok(())
    }

    pub fn restrict_address(env: Env, admin: Address, target: Address) -> Result<(), Error> {
        admin.require_auth();
        require_admin(&env, &admin)?;
        let mut r = get_restricted(&env);
        r.set(target, true);
        env.storage().instance().set(&RESTRICT, &r);
        Ok(())
    }

    pub fn unrestrict_address(env: Env, admin: Address, target: Address) -> Result<(), Error> {
        admin.require_auth();
        require_admin(&env, &admin)?;
        let mut r = get_restricted(&env);
        r.remove(target);
        env.storage().instance().set(&RESTRICT, &r);
        Ok(())
    }

    pub fn pause_contract(env: Env, pauser: Address) -> Result<(), Error> {
        pauser.require_auth();
        require_role(&env, &pauser, ROLE_PAUSER)?;
        env.storage().instance().set(&PAUSED, &true);
        Ok(())
    }

    pub fn unpause_contract(env: Env, pauser: Address) -> Result<(), Error> {
        pauser.require_auth();
        require_role(&env, &pauser, ROLE_PAUSER)?;
        env.storage().instance().set(&PAUSED, &false);
        Ok(())
    }

    pub fn is_address_restricted(env: Env, target: Address) -> bool {
        is_restricted(&env, &target)
    }

    /// Withdraw from multiple streams atomically. All-or-nothing semantics. (issue #1472)
    pub fn batch_withdraw(
        env: Env,
        stream_ids: Vec<u64>,
        receiver: Address,
    ) -> Result<Vec<i128>, Error> {
        receiver.require_auth();
        if stream_ids.len() > 20 { return Err(Error::BatchSizeExceeded); }
        if stream_ids.is_empty() { return Err(Error::InvalidAmount); }

        let mut amounts: Vec<i128> = Vec::new(&env);
        let mut total: i128 = 0;
        for i in 0..stream_ids.len() {
            let sid = stream_ids.get(i).unwrap();
            let streams = get_streams(&env);
            let stream = streams.get(sid).ok_or(Error::StreamNotFound)?;
            if stream.receiver != receiver { return Err(Error::Unauthorized); }
            if stream.state == STATE_CLOSED { return Err(Error::AlreadyCancelled); }
            if stream.state == STATE_PAUSED { return Err(Error::StreamPaused); }
            let unlocked = unlocked_amount(&env, &stream);
            let w = unlocked - stream.withdrawn_amount;
            if w > 0 { amounts.push_back(w); total += w; } else { amounts.push_back(0); }
        }
        if total <= 0 { return Err(Error::InsufficientBalance); }

        for i in 0..stream_ids.len() {
            let amt = amounts.get(i).unwrap();
            if amt > 0 {
                let sid = stream_ids.get(i).unwrap();
                let mut streams = get_streams(&env);
                let mut stream = streams.get(sid).unwrap();
                stream.withdrawn_amount += amt;
                streams.set(sid, stream.clone());
                env.storage().persistent().set(&STREAMS, &streams);
                TokenClient::new(&env, &stream.token).transfer(&stream.sender, &receiver, &amt);
            }
        }
        Ok(amounts)
    }

    /// Update the metadata for a stream. Only the sender may update metadata.
    pub fn update_stream_metadata(
        env: Env,
        stream_id: u64,
        sender: Address,
        label: String,
        tags: Vec<String>,
        external_ref: Option<String>,
    ) -> Result<(), Error> {
        sender.require_auth();
        let stream = get_stream(&env, stream_id)?;
        if stream.sender != sender { return Err(Error::Unauthorized); }
        if stream.state == STATE_CLOSED { return Err(Error::StreamEnded); }
        if label.len() > 64 { return Err(Error::MetadataLabelTooLong); }
        if tags.len() > 5 { return Err(Error::TooManyTags); }
        for i in 0..tags.len() {
            if let Some(tag) = tags.get(i) {
                if tag.len() > 32 { return Err(Error::TagTooLong); }
            }
        }
        let mut metadata = get_metadata_map(&env);
        metadata.set(
            stream_id,
            StreamMetadata {
                label,
                tags,
                external_ref,
            },
        );
        env.storage().persistent().set(&METADATA, &metadata);
        env.events().publish(
            (symbol_short!("meta_upd"), sender.clone()),
            StreamMetadataUpdatedEvent { stream_id, sender, timestamp: env.ledger().timestamp() },
        );
        Ok(())
    }

    /// Return the metadata attached to a stream, if any has been set.
    pub fn get_stream_metadata(env: Env, stream_id: u64) -> Option<StreamMetadata> {
        get_metadata_map(&env).get(stream_id)
    }

    /// Return the next stream id that will be allocated (for testing/inspection).
    pub fn next_stream_id(env: Env) -> u64 {
        env.storage().instance().get::<_, u64>(&NEXTID).unwrap_or(1)
    }

    // ------------------------- History Queries -------------------------

    pub fn get_stream_history(env: Env, stream_id: u64) -> Vec<StreamEvent> {
        get_history(&env).get(stream_id).unwrap_or(Vec::new(&env))
    // ------------------------- Count Queries -------------------------

    pub fn get_active_streams_count(env: Env) -> u64 {
        let streams = get_streams(&env);
        let mut count = 0u64;
        for (_, stream) in streams.iter() {
            if stream.state == STATE_ACTIVE {
                count += 1;
            }
        }
        count
    }

    pub fn get_user_active_streams_count(env: Env, user: Address) -> u64 {
        let streams = get_streams(&env);
        let mut count = 0u64;
        for (_, stream) in streams.iter() {
            if stream.state == STATE_ACTIVE && (stream.sender == user || stream.receiver == user) {
                count += 1;
            }
        }
        count
    }

    pub fn get_total_streams_count(env: Env) -> u64 {
        let next_id = env.storage().instance().get::<_, u64>(&NEXTID).unwrap_or(1);
        next_id - 1
    }

    pub fn get_user_total_streams_count(env: Env, user: Address) -> u64 {
        get_user_streams(&env, &user).len() as u64
    }

    pub fn get_paused_streams_count(env: Env) -> u64 {
        let streams = get_streams(&env);
        let mut count = 0u64;
        for (_, stream) in streams.iter() {
            if stream.state == STATE_PAUSED {
                count += 1;
            }
        }
        count
    }

    pub fn get_user_paused_streams_count(env: Env, user: Address) -> u64 {
        let streams = get_streams(&env);
        let mut count = 0u64;
        for (_, stream) in streams.iter() {
            if stream.state == STATE_PAUSED && (stream.sender == user || stream.receiver == user) {
                count += 1;
            }
        }
        count
    }

    pub fn get_closed_streams_count(env: Env) -> u64 {
        let streams = get_streams(&env);
        let mut count = 0u64;
        for (_, stream) in streams.iter() {
            if stream.state == STATE_CLOSED {
                count += 1;
            }
        }
        count
    }

    pub fn get_user_closed_streams_count(env: Env, user: Address) -> u64 {
        let streams = get_streams(&env);
        let mut count = 0u64;
        for (_, stream) in streams.iter() {
            if stream.state == STATE_CLOSED && (stream.sender == user || stream.receiver == user) {
                count += 1;
            }
        }
        count
    }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------
fn withdraw_inner(env: &Env, stream_id: u64, receiver: &Address) -> Result<i128, Error> {
    let mut stream = get_stream(env, stream_id)?;
    if stream.state == STATE_CLOSED {
        return Err(Error::AlreadyCancelled);
    }
    if stream.state == STATE_PAUSED {
        return Err(Error::StreamPaused);
    }
    if &stream.receiver != receiver {
        return Err(Error::Unauthorized);
    }

    let withdrawable = withdrawable_amount(env, &stream);
    if withdrawable <= 0 {
        return Ok(0);
    }

    // Checks-effects-interactions: mutate state BEFORE any external call so a
    // re-entrant token callback cannot double-spend.
    stream.withdrawn_amount = stream
        .withdrawn_amount
        .checked_add(withdrawable)
        .ok_or(Error::Overflow)?;
    save_stream(env, &stream);

    // External token transfer (best-effort; a malicious token cannot double-spend
    // because state above is already committed).
    TokenClient::new(env, &stream.token).transfer(&stream.sender, receiver, &withdrawable);

    // Record history event
    add_history(env, stream_id, StreamAction::Withdrawn(withdrawable));

    Ok(withdrawable)
}

fn unlocked_amount(env: &Env, stream: &Stream) -> i128 {
    let now = env.ledger().timestamp();
    if now <= stream.start_time {
        return 0;
    }
    let dur = stream.end_time - stream.start_time;
    let mut elapsed = now - stream.start_time;
    if elapsed > stream.paused_duration {
        elapsed -= stream.paused_duration;
    } else {
        elapsed = 0;
    }
    if elapsed >= dur || now >= stream.end_time {
        return stream.total_amount;
    }
    if stream.total_amount == 0 {
        return 0;
    }
    let unlocked = match stream.curve_type {
        CURVE_LINEAR => {
            let prod = (elapsed as i128).checked_mul(stream.total_amount);
            match prod {
                Some(p) => p / (dur as i128),
                None => return 0,
            }
        }
        CURVE_EXP => {
            let e = elapsed as i128;
            let d = dur as i128;
            // quadratic: total * elapsed^2 / dur^2
            let num = e.checked_mul(e).and_then(|v| v.checked_mul(stream.total_amount));
            let den = d.checked_mul(d);
            match (num, den) {
                (Some(n), Some(den)) if den != 0 => n / den,
                _ => 0,
            }
        }
        CURVE_MILESTONE => match &stream.milestones {
            // Milestones are keyed to absolute ledger timestamps, not
            // pause-adjusted elapsed time, so `now` is passed directly.
            Some(milestones) => {
                math::calculate_unlocked_milestone(stream.total_amount, now, milestones)
            }
            None => 0,
        },
        _ => 0,
    };
    if unlocked < 0 {
        0
    } else {
        unlocked
    }
}

fn withdrawable_amount(env: &Env, stream: &Stream) -> i128 {
    let unlocked = unlocked_amount(env, stream);
    let w = unlocked - stream.withdrawn_amount;
    if w < 0 {
        0
    } else {
        w
    }
}

fn get_streams(env: &Env) -> Map<u64, Stream> {
    env.storage()
        .persistent()
        .get(&STREAMS)
        .unwrap_or(Map::new(env))
}

fn get_metadata_map(env: &Env) -> Map<u64, StreamMetadata> {
    env.storage()
        .persistent()
        .get(&METADATA)
        .unwrap_or(Map::new(env))
}

fn get_stream(env: &Env, stream_id: u64) -> Result<Stream, Error> {
    get_streams(env)
        .get(stream_id)
        .ok_or(Error::StreamNotFound)
}

fn save_stream(env: &Env, stream: &Stream) {
    let mut streams = get_streams(env);
    streams.set(stream.id, stream.clone());
    env.storage().persistent().set(&STREAMS, &streams);
}

/// Shared stream-creation path used both by `create_stream` (single-signature)
/// and by `approve_proposal` (multi-signature auto-execution). Does not require
/// the sender's auth because proposal execution is authorized by the approvals.
fn create_stream_internal(
    env: &Env,
    sender: &Address,
    receiver: &Address,
    token: &Address,
    total_amount: i128,
    start_time: u64,
    end_time: u64,
    curve_type: u32,
    is_soulbound: bool,
    milestones: Option<Vec<Milestone>>,
) -> Result<u64, Error> {
    if is_contract_paused(env) {
        return Err(Error::ContractPaused);
    }
    if env.storage().instance().get::<_, Address>(&ADMIN).is_none() {
        return Err(Error::Unauthorized);
    }
    if curve_type != CURVE_LINEAR && curve_type != CURVE_EXP && curve_type != CURVE_MILESTONE {
        return Err(Error::InvalidCurve);
    }
    if total_amount <= 0 {
        return Err(Error::InvalidAmount);
    }
    if start_time >= end_time {
        return Err(Error::InvalidTimeRange);
    }
    if is_restricted(env, sender) || is_restricted(env, receiver) {
        return Err(Error::AddressRestricted);
    }
    if curve_type == CURVE_MILESTONE {
        validate_milestones(&milestones, end_time)?;
    } else if milestones.is_some() {
        return Err(Error::InvalidMilestones);
    }

    let mut next = env.storage().instance().get::<_, u64>(&NEXTID).unwrap_or(1);
    let id = next;
    next = next.checked_add(1).ok_or(Error::Overflow)?;

    let stream = Stream {
        id,
        sender: sender.clone(),
        receiver: receiver.clone(),
        token: token.clone(),
        total_amount,
        start_time,
        end_time,
        withdrawn_amount: 0,
        state: STATE_ACTIVE,
        curve_type,
        is_soulbound,
        paused_duration: 0,
        last_paused_at: 0,
        stream_metadata: None,
        milestones,
    };

    let mut streams = get_streams(env);
    streams.set(id, stream);
    env.storage().persistent().set(&STREAMS, &streams);

    add_user_stream(env, sender, id);
    add_user_stream(env, receiver, id);

    env.storage().instance().set(&NEXTID, &next);
    Ok(id)
}

/// Validates a milestone-vesting schedule before it is attached to a stream.
///
/// Requires: a non-empty schedule, strictly ascending timestamps, strictly
/// ascending cumulative percentages, a final percentage of exactly
/// `math::BPS_DENOMINATOR` (10,000 bps = 100%), and a last-milestone timestamp
/// no later than the stream's `end_time` (otherwise the stream's end-of-term
/// fast path in `unlocked_amount` could release 100% before the schedule says
/// it should).
fn validate_milestones(milestones: &Option<Vec<Milestone>>, end_time: u64) -> Result<(), Error> {
    let milestones = milestones.as_ref().ok_or(Error::InvalidMilestones)?;
    if milestones.is_empty() {
        return Err(Error::InvalidMilestones);
    }

    let mut prev_timestamp: Option<u64> = None;
    let mut prev_percentage: u32 = 0;
    for i in 0..milestones.len() {
        let m = milestones.get(i).unwrap();
        if let Some(prev) = prev_timestamp {
            if m.timestamp <= prev {
                return Err(Error::InvalidMilestones);
            }
        }
        if m.percentage <= prev_percentage {
            return Err(Error::InvalidMilestonePercentages);
        }
        prev_timestamp = Some(m.timestamp);
        prev_percentage = m.percentage;
    }

    if prev_percentage as i128 != math::BPS_DENOMINATOR {
        return Err(Error::InvalidMilestonePercentages);
    }
    if prev_timestamp.unwrap() > end_time {
        return Err(Error::InvalidTimeRange);
    }

    Ok(())
}

fn get_proposals(env: &Env) -> Map<u64, StreamProposal> {
    env.storage()
        .persistent()
        .get(&PROPOSALS)
        .unwrap_or(Map::new(env))
}

fn get_proposal(env: &Env, proposal_id: u64) -> Result<StreamProposal, Error> {
    get_proposals(env)
        .get(proposal_id)
        .ok_or(Error::ProposalNotFound)
}

fn save_proposal(env: &Env, proposal_id: u64, proposal: &StreamProposal) {
    let mut proposals = get_proposals(env);
    proposals.set(proposal_id, proposal.clone());
    env.storage().persistent().set(&PROPOSALS, &proposals);
}

fn get_user_streams(env: &Env, user: &Address) -> Vec<u64> {
    env.storage()
        .persistent()
        .get(&USTREAMS)
        .unwrap_or(Map::new(env))
        .get(user.clone())
        .unwrap_or(Vec::new(env))
}

fn add_user_stream(env: &Env, user: &Address, id: u64) {
    let mut all: Map<Address, Vec<u64>> = env
        .storage()
        .persistent()
        .get(&USTREAMS)
        .unwrap_or(Map::new(env));
    let mut list = all.get(user.clone()).unwrap_or(Vec::new(env));
    list.push_back(id);
    all.set(user.clone(), list);
    env.storage().persistent().set(&USTREAMS, &all);
}

/// Protocol fee rate in basis points; `0` when unset.
fn fee_bps(env: &Env) -> u32 {
    env.storage().instance().get(&FEEBPS).unwrap_or(0)
}

/// Fee owed on `amount` at the current rate, rounded down.
///
/// The multiplication is checked so that a very large `amount` reports
/// [`Error::Overflow`] instead of wrapping into a nonsensical fee.
fn protocol_fee_for(env: &Env, amount: i128) -> Result<i128, Error> {
    let bps = fee_bps(env);
    if bps == 0 || amount <= 0 {
        return Ok(0);
    }
    amount
        .checked_mul(bps as i128)
        .map(|scaled| scaled / BPS_DENOMINATOR)
        .ok_or(Error::Overflow)
}

/// Transfer the protocol fee for `amount` from `sender` to the treasury.
///
/// Returns the fee charged. A zero fee short-circuits without touching the
/// token contract, so a zero-fee protocol costs nothing extra to run.
fn collect_protocol_fee(
    env: &Env,
    sender: &Address,
    token: &Address,
    stream_id: u64,
    amount: i128,
) -> Result<i128, Error> {
    let fee = protocol_fee_for(env, amount)?;
    if fee == 0 {
        return Ok(0);
    }
    let treasury = env
        .storage()
        .instance()
        .get::<_, Address>(&TREASURY)
        .ok_or(Error::TreasuryNotSet)?;

    TokenClient::new(env, token).transfer(sender, &treasury, &fee);

    env.events().publish(
        (symbol_short!("fee"), sender.clone()),
        ProtocolFeeCollectedEvent {
            stream_id,
            payer: sender.clone(),
            treasury,
            token: token.clone(),
            fee_amount: fee,
            fee_bps: fee_bps(env),
        },
    );
    Ok(fee)
}

/// Fee settings may be changed by a treasury manager or by an admin.
fn require_treasury_manager(env: &Env, account: &Address) -> Result<(), Error> {
    if has_role(env, account, ROLE_TREASURY) || has_role(env, account, ROLE_ADMIN) {
        Ok(())
    } else {
        Err(Error::Unauthorized)
    }
}

fn is_contract_paused(env: &Env) -> bool {
    env.storage().instance().get(&PAUSED).unwrap_or(false)
}

fn get_history(env: &Env) -> Map<u64, Vec<StreamEvent>> {
    env.storage()
        .persistent()
        .get(&HISTORY)
        .unwrap_or(Map::new(env))
}

fn add_history(env: &Env, stream_id: u64, action: StreamAction) {
    let mut history = get_history(env);
    let mut events = history.get(stream_id).unwrap_or(Vec::new(env));
    events.push_back(StreamEvent {
        stream_id,
        action,
        timestamp: env.ledger().timestamp(),
    });
    history.set(stream_id, events);
    env.storage().persistent().set(&HISTORY, &history);
}

fn is_restricted(env: &Env, target: &Address) -> bool {
    get_restricted(env).get(target.clone()).unwrap_or(false)
}

fn get_restricted(env: &Env) -> Map<Address, bool> {
    env.storage().instance().get(&RESTRICT).unwrap_or(Map::new(env))
}

fn require_admin(env: &Env, account: &Address) -> Result<(), Error> {
    require_role(env, account, ROLE_ADMIN)
}

fn require_role(env: &Env, account: &Address, role: u32) -> Result<(), Error> {
    if !has_role(env, account, role) {
        return Err(if role == ROLE_ADMIN {
            Error::NotAdmin
        } else {
            Error::NotPauser
        });
    }
    Ok(())
}

fn has_role(env: &Env, account: &Address, role: u32) -> bool {
    let roles: Map<Address, Vec<u32>> = env
        .storage()
        .instance()
        .get(&ROLES)
        .unwrap_or(Map::new(env));
    roles
        .get(account.clone())
        .map(|v| v.contains(role))
        .unwrap_or(false)
}

fn grant_role_internal(env: Env, account: &Address, role: u32) {
    let mut roles: Map<Address, Vec<u32>> = env
        .storage()
        .instance()
        .get(&ROLES)
        .unwrap_or(Map::new(&env));
    let mut list = roles.get(account.clone()).unwrap_or(Vec::new(&env));
    if !list.contains(role) {
        list.push_back(role);
    }
    roles.set(account.clone(), list);
    env.storage().instance().set(&ROLES, &roles);
}

fn revoke_role_internal(env: &Env, account: &Address, role: u32) {
    let mut roles: Map<Address, Vec<u32>> = env
        .storage()
        .instance()
        .get(&ROLES)
        .unwrap_or(Map::new(env));
    if let Some(list) = roles.get(account.clone()) {
        let mut out = Vec::new(env);
        let len = list.len();
        for i in 0..len {
            if let Some(r) = list.get(i) {
                if r != role {
                    out.push_back(r);
                }
            }
        }
        roles.set(account.clone(), out);
        env.storage().instance().set(&ROLES, &roles);
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
#[cfg(test)]
mod common;

#[cfg(test)]
mod test;

#[cfg(test)]
mod stress_test;

#[cfg(test)]
mod security_test;

#[cfg(test)]
mod fee_test;
