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
//! - Health and usage metrics for production monitoring
//!
//! # Monitoring
//!
//! [`StellarStreamContract::health_check`] reports point-in-time state (paused
//! flag, active stream count, per-token TVL, last activity, version) and
//! [`StellarStreamContract::get_metrics`] reports rolling 24-hour usage
//! (streams created, withdrawals, average duration and size, unique users).
//!
//! Both are read-only and cheap enough to poll frequently, which is the whole
//! point of a health endpoint. That is achieved by maintaining counters as
//! operations happen rather than deriving them on read: a read that scanned
//! stream state would get more expensive exactly as the contract got busier.
//! Usage statistics live in hourly buckets, so a read sums at most
//! [`METRICS_WINDOW_HOURS`] entries no matter how much traffic there was, and
//! buckets outside the window are pruned at most once per hour.
//!
//! `unique_users_24h` is the one deliberately approximate figure: it is capped
//! at [`MAX_TRACKED_USERS`] so the address set cannot grow without bound. Above
//! that it saturates, and should be read as "at least this many".
//!
//! See `METRICS.md` for the Prometheus exporter and Grafana setup that consume
//! these two functions.
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
const ACTIVE: Symbol = symbol_short!("ACTIVE");
const TVL: Symbol = symbol_short!("TVL");
const LASTACT: Symbol = symbol_short!("LASTACT");
const BUCKETS: Symbol = symbol_short!("BUCKETS");
const USERSEEN: Symbol = symbol_short!("USERSEEN");
const LASTPRUNE: Symbol = symbol_short!("LASTPRUN");
const NEXTPROPOSAL: Symbol = symbol_short!("NEXTPROP");

// Stream state
pub const STATE_ACTIVE: u32 = 0;
pub const STATE_PAUSED: u32 = 1;
pub const STATE_CLOSED: u32 = 2;

// Vesting curve
pub const CURVE_LINEAR: u32 = 0;
pub const CURVE_EXP: u32 = 1;

// Monitoring
/// Version reported by [`StellarStreamContract::health_check`].
pub const CONTRACT_VERSION: u32 = 1;
/// Width of the rolling metrics window, in hourly buckets.
pub const METRICS_WINDOW_HOURS: u64 = 24;
/// Seconds per metrics bucket.
pub const SECONDS_PER_HOUR: u64 = 3_600;
/// Ceiling on addresses tracked for `unique_users_24h`, so that both the
/// bookkeeping and the read stay bounded regardless of traffic.
pub const MAX_TRACKED_USERS: u32 = 64;

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

/// Point-in-time health of the contract, for liveness checks and alerting.
///
/// Every field is an O(1) read of a counter maintained as streams change, so
/// this is cheap enough to poll frequently.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ContractHealth {
    /// Whether the contract is globally paused.
    pub is_paused: bool,
    /// Streams that have not been closed.
    pub active_streams: u64,
    /// Value still owed to receivers, per token address.
    pub total_tvl: Map<Address, i128>,
    /// Ledger timestamp of the last state-changing operation.
    pub last_activity_time: u64,
    /// Contract version, see [`CONTRACT_VERSION`].
    pub version: u32,
}

/// Rolling 24-hour usage statistics.
///
/// Derived from at most [`METRICS_WINDOW_HOURS`] hourly buckets that are
/// updated as operations happen, so reading them never scans stream state.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ContractMetrics {
    /// Streams created in the last 24 hours.
    pub streams_created_24h: u64,
    /// Withdrawals executed in the last 24 hours.
    pub withdrawals_24h: u64,
    /// Mean duration of streams created in the window, in seconds.
    pub avg_stream_duration: u64,
    /// Mean size of streams created in the window, in token units.
    pub avg_stream_amount: i128,
    /// Distinct addresses seen in the window, capped at [`MAX_TRACKED_USERS`].
    pub unique_users_24h: u64,
}

/// One hour of activity. Buckets outside the window are pruned.
#[contracttype]
#[derive(Clone, Debug)]
pub struct MetricBucket {
    /// Streams created during this hour.
    pub streams_created: u64,
    /// Withdrawals during this hour.
    pub withdrawals: u64,
    /// Sum of created stream durations, for the running average.
    pub duration_sum: u64,
    /// Sum of created stream amounts, for the running average.
    pub amount_sum: i128,
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
    ) -> Result<u64, Error> {
        sender.require_auth();
        create_stream_internal(
            &env,
            &sender,
            &receiver,
            &token,
            total_amount,
            start_time,
            end_time,
            curve_type,
            is_soulbound,
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
        record_stream_closed(&env, &stream);
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

    // ------------------------- Monitoring -------------------------

    /// Point-in-time health of the contract.
    ///
    /// Read-only, and O(1) apart from copying the per-token TVL map: every
    /// field is a counter maintained as streams change rather than something
    /// derived by scanning stream state, so this is safe to poll on a short
    /// interval. See `METRICS.md` for the exporter that scrapes it.
    pub fn health_check(env: Env) -> ContractHealth {
        ContractHealth {
            is_paused: is_contract_paused(&env),
            active_streams: env.storage().instance().get(&ACTIVE).unwrap_or(0),
            total_tvl: get_tvl(&env),
            last_activity_time: env.storage().instance().get(&LASTACT).unwrap_or(0),
            version: CONTRACT_VERSION,
        }
    }

    /// Rolling 24-hour usage statistics.
    ///
    /// Read-only. Sums at most [`METRICS_WINDOW_HOURS`] hourly buckets, so cost
    /// is bounded by the width of the window and not by how many streams or
    /// users exist. Averages are over streams *created* in the window and are
    /// zero when the window is empty.
    ///
    /// `unique_users_24h` is capped at [`MAX_TRACKED_USERS`]: once that many
    /// distinct addresses are active within a window the count saturates rather
    /// than growing without bound. Treat it as "at least this many".
    pub fn get_metrics(env: Env) -> ContractMetrics {
        let cutoff = window_start_hour(&env);
        let buckets = get_buckets(&env);

        let mut streams_created_24h: u64 = 0;
        let mut withdrawals_24h: u64 = 0;
        let mut duration_sum: u64 = 0;
        let mut amount_sum: i128 = 0;

        for (hour, bucket) in buckets.iter() {
            if hour < cutoff {
                continue;
            }
            streams_created_24h = streams_created_24h.saturating_add(bucket.streams_created);
            withdrawals_24h = withdrawals_24h.saturating_add(bucket.withdrawals);
            duration_sum = duration_sum.saturating_add(bucket.duration_sum);
            amount_sum = amount_sum.saturating_add(bucket.amount_sum);
        }

        let (avg_stream_duration, avg_stream_amount) = if streams_created_24h == 0 {
            (0, 0)
        } else {
            (
                duration_sum / streams_created_24h,
                amount_sum / streams_created_24h as i128,
            )
        };

        let mut unique_users_24h: u64 = 0;
        for (_, last_seen) in get_user_seen(&env).iter() {
            if last_seen >= cutoff {
                unique_users_24h += 1;
            }
        }

        ContractMetrics {
            streams_created_24h,
            withdrawals_24h,
            avg_stream_duration,
            avg_stream_amount,
            unique_users_24h,
        }
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
                record_withdrawal(&env, &receiver, &stream.token, amt);
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
    record_withdrawal(env, receiver, &stream.token, withdrawable);

    // External token transfer (best-effort; a malicious token cannot double-spend
    // because state above is already committed).
    TokenClient::new(env, &stream.token).transfer(&stream.sender, receiver, &withdrawable);

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
) -> Result<u64, Error> {
    if is_contract_paused(env) {
        return Err(Error::ContractPaused);
    }
    if env.storage().instance().get::<_, Address>(&ADMIN).is_none() {
        return Err(Error::Unauthorized);
    }
    if curve_type != CURVE_LINEAR && curve_type != CURVE_EXP {
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
    };

    let mut streams = get_streams(env);
    streams.set(id, stream.clone());
    env.storage().persistent().set(&STREAMS, &streams);

    record_stream_created(env, &stream);

    add_user_stream(env, sender, id);
    add_user_stream(env, receiver, id);

    env.storage().instance().set(&NEXTID, &next);
    Ok(id)
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

// ---------------------------------------------------------------------------
// Monitoring bookkeeping
//
// Counters are maintained as operations happen so that `health_check` and
// `get_metrics` stay read-only and cheap. The alternative -- deriving them by
// scanning stream state on read -- would make the read cost grow with the size
// of the contract, which is exactly what a frequently polled health endpoint
// must not do.
// ---------------------------------------------------------------------------

/// The oldest hour still inside the rolling window.
fn window_start_hour(env: &Env) -> u64 {
    current_hour(env).saturating_sub(METRICS_WINDOW_HOURS - 1)
}

fn current_hour(env: &Env) -> u64 {
    env.ledger().timestamp() / SECONDS_PER_HOUR
}

fn get_buckets(env: &Env) -> Map<u64, MetricBucket> {
    env.storage()
        .persistent()
        .get(&BUCKETS)
        .unwrap_or(Map::new(env))
}

fn get_user_seen(env: &Env) -> Map<Address, u64> {
    env.storage()
        .persistent()
        .get(&USERSEEN)
        .unwrap_or(Map::new(env))
}

fn get_tvl(env: &Env) -> Map<Address, i128> {
    env.storage().instance().get(&TVL).unwrap_or(Map::new(env))
}

/// Record that something happened, and fold `user` into the 24h active set.
fn touch_activity(env: &Env, user: &Address) {
    env.storage()
        .instance()
        .set(&LASTACT, &env.ledger().timestamp());
    prune_window(env);

    let hour = current_hour(env);
    let mut seen = get_user_seen(env);
    // Refreshing an address already tracked is always allowed; only admitting a
    // new one is capped, so a busy contract keeps reporting its regulars.
    if seen.get(user.clone()).is_some() || seen.len() < MAX_TRACKED_USERS {
        seen.set(user.clone(), hour);
        env.storage().persistent().set(&USERSEEN, &seen);
    }
}

/// Drop buckets and address entries that have fallen out of the window.
///
/// Runs at most once per hour: the scan is bounded, but there is no reason to
/// repeat it on every operation within the same hour.
fn prune_window(env: &Env) {
    let hour = current_hour(env);
    let last_prune: Option<u64> = env.storage().instance().get(&LASTPRUNE);
    if last_prune == Some(hour) {
        return;
    }
    env.storage().instance().set(&LASTPRUNE, &hour);

    let cutoff = window_start_hour(env);

    let buckets = get_buckets(env);
    let mut fresh_buckets = Map::new(env);
    for (bucket_hour, bucket) in buckets.iter() {
        if bucket_hour >= cutoff {
            fresh_buckets.set(bucket_hour, bucket);
        }
    }
    env.storage().persistent().set(&BUCKETS, &fresh_buckets);

    let seen = get_user_seen(env);
    let mut fresh_seen = Map::new(env);
    for (address, last_seen) in seen.iter() {
        if last_seen >= cutoff {
            fresh_seen.set(address, last_seen);
        }
    }
    env.storage().persistent().set(&USERSEEN, &fresh_seen);
}

fn with_current_bucket(env: &Env, update: impl FnOnce(&mut MetricBucket)) {
    let hour = current_hour(env);
    let mut buckets = get_buckets(env);
    let mut bucket = buckets.get(hour).unwrap_or(MetricBucket {
        streams_created: 0,
        withdrawals: 0,
        duration_sum: 0,
        amount_sum: 0,
    });
    update(&mut bucket);
    buckets.set(hour, bucket);
    env.storage().persistent().set(&BUCKETS, &buckets);
}

/// Fold a stream creation into the counters.
fn record_stream_created(env: &Env, stream: &Stream) {
    touch_activity(env, &stream.sender);

    let active: u64 = env.storage().instance().get(&ACTIVE).unwrap_or(0);
    env.storage()
        .instance()
        .set(&ACTIVE, &active.saturating_add(1));

    adjust_tvl(env, &stream.token, stream.total_amount);

    let duration = stream.end_time.saturating_sub(stream.start_time);
    let amount = stream.total_amount;
    with_current_bucket(env, |bucket| {
        bucket.streams_created = bucket.streams_created.saturating_add(1);
        bucket.duration_sum = bucket.duration_sum.saturating_add(duration);
        bucket.amount_sum = bucket.amount_sum.saturating_add(amount);
    });
}

/// Fold a withdrawal into the counters. `amount` leaves the locked total.
fn record_withdrawal(env: &Env, receiver: &Address, token: &Address, amount: i128) {
    touch_activity(env, receiver);
    adjust_tvl(env, token, -amount);
    with_current_bucket(env, |bucket| {
        bucket.withdrawals = bucket.withdrawals.saturating_add(1);
    });
}

/// Fold a cancellation into the counters. The unwithdrawn remainder is released.
fn record_stream_closed(env: &Env, stream: &Stream) {
    touch_activity(env, &stream.sender);

    let active: u64 = env.storage().instance().get(&ACTIVE).unwrap_or(0);
    env.storage()
        .instance()
        .set(&ACTIVE, &active.saturating_sub(1));

    let remaining = stream.total_amount.saturating_sub(stream.withdrawn_amount);
    adjust_tvl(env, &stream.token, -remaining);
}

/// Move the locked total for `token` by `delta`, clamping at zero.
fn adjust_tvl(env: &Env, token: &Address, delta: i128) {
    let mut tvl = get_tvl(env);
    let current = tvl.get(token.clone()).unwrap_or(0);
    let next = current.saturating_add(delta);
    tvl.set(token.clone(), if next < 0 { 0 } else { next });
    env.storage().instance().set(&TVL, &tvl);
}

fn is_contract_paused(env: &Env) -> bool {
    env.storage().instance().get(&PAUSED).unwrap_or(false)
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
mod metrics_test;
