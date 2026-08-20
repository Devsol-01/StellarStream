#![no_std]
#![allow(clippy::too_many_arguments)]

mod errors;
mod flash_loan;
mod interest;
mod math;
mod oracle;
mod rbac;
mod storage;
mod types;
mod upgrade;
mod vault;
mod voting;

#[cfg(test)]
mod remaining_time_test;

#[cfg(test)]
mod stream_active_test;

#[cfg(test)]
mod pause_resume_test;

#[cfg(test)]
mod cliff_test;

#[cfg(test)]
#[cfg(all(test, feature = "allowlist_tests"))]
mod allowlist_test;
#[cfg(all(test, feature = "clawback_tests"))]
mod clawback_test;
#[cfg(all(test, feature = "dispute_tests"))]
mod dispute_test;
#[cfg(test)]
mod soulbound_test;
#[cfg(test)]
mod topup_test;

// Advanced-feature integration test suites (issue #1480).
// These exercise RBAC, multi-sig proposals, vault integration, OFAC
// compliance, and multi-step cross-feature workflows against the current
// contract implementation.
#[cfg(test)]
mod rbac_test;
#[cfg(test)]
mod proposal_test;
#[cfg(test)]
mod vault_test;
#[cfg(test)]
mod compliance_test;
#[cfg(test)]
mod advanced_test;

#[cfg(all(test, feature = "voting_tests"))]
mod voting_test;

#[cfg(test)]
mod bench_test;

// #[cfg(test)]
// mod interest_test;

// #[cfg(test)]
// mod mock_vault;

// #[cfg(test)]
// mod vault_integration_test;

#[cfg(test)]
mod ttl_stress_test;

#[cfg(test)]
mod test;

use errors::Error;
use soroban_sdk::{contract, contractimpl, symbol_short, token, Address, Env, Map, Vec};
use storage::{PROPOSAL_COUNT, RECEIPT, RESTRICTED_ADDRESSES, STREAM_COUNT};
use types::{
    ContributorRequest, CurveType, DataKey, Milestone, ProposalApprovedEvent, ProposalCreatedEvent,
    ReceiptMetadata, RequestCreatedEvent, RequestExecutedEvent, RequestKey, RequestStatus, Role,
    Stream, StreamCreatedEvent, StreamOptions, StreamProposal, StreamReceipt, StreamRequest,
    StreamResumedEvent, StreamState,
};

#[contract]
pub struct StellarStreamContract;

#[contractimpl]
impl StellarStreamContract {
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

        // Validate time range
        if start_time >= end_time {
            return Err(Error::InvalidTimeRange);
        }
        if total_amount <= 0 {
            return Err(Error::InvalidAmount);
        }
        if required_approvals == 0 {
            return Err(Error::InvalidApprovalThreshold);
        }
        if deadline <= env.ledger().timestamp() {
            return Err(Error::ProposalExpired);
        }
        if Self::is_address_restricted(env.clone(), receiver.clone()) {
            soroban_sdk::panic_with_error!(&env, Error::AddressRestricted);
        }

        let proposal_id: u64 = env.storage().instance().get(&PROPOSAL_COUNT).unwrap_or(0);
        let next_id = proposal_id + 1;

        let proposal = StreamProposal {
            sender: sender.clone(),
            receiver: receiver.clone(),
            token: token.clone(),
            total_amount,
            start_time,
            end_time,
            approvers: Vec::new(&env),
            required_approvals,
            deadline,
            executed: false,
        };

        env.storage()
            .instance()
            .set(&(PROPOSAL_COUNT, proposal_id), &proposal);
        env.storage().instance().set(&PROPOSAL_COUNT, &next_id);

        // Emit ProposalCreatedEvent
        env.events().publish(
            (symbol_short!("create"), sender.clone()),
            ProposalCreatedEvent {
                proposal_id,
                sender: sender.clone(),
                receiver: receiver.clone(),
                token: token.clone(),
                total_amount,
                start_time,
                end_time,
                required_approvals,
                deadline,
                timestamp: env.ledger().timestamp(),
            },
        );

        Ok(proposal_id)
    }

    pub fn approve_proposal(env: Env, proposal_id: u64, approver: Address) -> Result<(), Error> {
        approver.require_auth();

        let key = (PROPOSAL_COUNT, proposal_id);
        let mut proposal: StreamProposal = env
            .storage()
            .instance()
            .get(&key)
            .ok_or(Error::ProposalNotFound)?;

        if proposal.executed {
            return Err(Error::ProposalAlreadyExecuted);
        }
        if env.ledger().timestamp() > proposal.deadline {
            return Err(Error::ProposalExpired);
        }

        for existing_approver in proposal.approvers.iter() {
            if existing_approver == approver {
                return Err(Error::AlreadyApproved);
            }
        }

        proposal.approvers.push_back(approver.clone());
        let approval_count = proposal.approvers.len();

        if approval_count >= proposal.required_approvals {
            proposal.executed = true;
            env.storage().instance().set(&key, &proposal);
            Self::execute_proposal(&env, proposal.clone())?;
        } else {
            env.storage().instance().set(&key, &proposal);
        }

        // Emit ProposalApprovedEvent
        env.events().publish(
            (symbol_short!("approve"), approver.clone()),
            ProposalApprovedEvent {
                proposal_id,
                approver: approver.clone(),
                approval_count,
                required_approvals: proposal.required_approvals,
                timestamp: env.ledger().timestamp(),
            },
        );

        Ok(())
    }

    fn execute_proposal(env: &Env, proposal: StreamProposal) -> Result<u64, Error> {
        // Transfer tokens from proposer to contract
        let token_client = token::Client::new(env, &proposal.token);
        token_client.transfer(
            &proposal.sender,
            &env.current_contract_address(),
            &proposal.total_amount,
        );

        // Allocate next stream id
        let stream_id: u64 = env.storage().instance().get(&STREAM_COUNT).unwrap_or(0);
        let next_id = stream_id + 1;

        let stream = Stream {
            sender: proposal.sender.clone(),
            receiver: proposal.receiver.clone(),
            token: proposal.token.clone(),
            total_amount: proposal.total_amount,
            start_time: proposal.start_time,
            cliff_time: proposal.start_time,
            end_time: proposal.end_time,
            withdrawn_amount: 0,
            interest_strategy: 0,
            vault_address: None,
            deposited_principal: proposal.total_amount,
            metadata: None,
            withdrawn: 0,
            receipt_owner: proposal.receiver.clone(),
            paused_time: 0,
            total_paused_duration: 0,
            milestones: Vec::new(env),
            curve_type: CurveType::Linear,
            is_usd_pegged: false,
            usd_amount: 0,
            oracle_address: proposal.sender.clone(),
            oracle_max_staleness: 0,
            price_min: 0,
            price_max: 0,
            is_soulbound: false,     // Proposals default to non-soulbound
            clawback_enabled: false, // Check at runtime if needed
            arbiter: None,
            is_frozen: false,
            state: StreamState::Active,
        };

        env.storage()
            .instance()
            .set(&(STREAM_COUNT, stream_id), &stream);
        env.storage().instance().set(&STREAM_COUNT, &next_id);

        // Emit StreamCreatedEvent
        env.events().publish(
            (symbol_short!("create"), proposal.sender.clone()),
            StreamCreatedEvent {
                stream_id,
                sender: proposal.sender.clone(),
                receiver: proposal.receiver.clone(),
                token: proposal.token,
                total_amount: proposal.total_amount,
                start_time: proposal.start_time,
                end_time: proposal.end_time,
                timestamp: env.ledger().timestamp(),
            },
        );
        Self::mint_receipt(env, stream_id, &proposal.receiver);

        Ok(stream_id)
    }

    /// Create a new stream with optional soulbound locking
    ///
    /// # Parameters
    /// - `is_soulbound`: Set to true to permanently bind this stream to the receiver's address.
    ///   Cannot be changed after stream creation. Irreversible.
    pub fn create_stream(
        env: Env,
        sender: Address,
        receiver: Address,
        token: Address,
        total_amount: i128,
        start_time: u64,
        cliff_time: u64,
        end_time: u64,
        curve_type: CurveType,
        is_soulbound: bool,
    ) -> Result<u64, Error> {
        sender.require_auth();

        let milestones = Vec::new(&env);
        let options = StreamOptions {
            curve_type,
            is_soulbound,
            vault_address: None,
        };
        Self::create_stream_internal(
            env,
            sender,
            receiver,
            token,
            total_amount,
            start_time,
            cliff_time,
            end_time,
            milestones,
            options,
        )
    }

    /// Create a new stream with milestones and optional soulbound locking
    ///
    /// # Parameters
    /// - `milestones`: Optional vesting milestones.
    /// - `options`: Bundled optional configuration (curve type, soulbound flag,
    ///   and optional yield-bearing vault).
    ///
    /// `options` bundles the optional knobs together so this entry point stays
    /// within Soroban's maximum contract function parameter count.
    pub fn create_stream_with_milestones(
        env: Env,
        sender: Address,
        receiver: Address,
        token: Address,
        total_amount: i128,
        start_time: u64,
        cliff_time: u64,
        end_time: u64,
        milestones: Vec<Milestone>,
        options: StreamOptions,
    ) -> Result<u64, Error> {
        sender.require_auth();
        Self::create_stream_internal(
            env,
            sender,
            receiver,
            token,
            total_amount,
            start_time,
            cliff_time,
            end_time,
            milestones,
            options,
        )
    }

    /// Internal, non-authorizing stream creation shared by the public entry
    /// points. Callers must authenticate `sender` exactly once per invocation
    /// to avoid duplicate-authorization traps.
    fn create_stream_internal(
        env: Env,
        sender: Address,
        receiver: Address,
        token: Address,
        total_amount: i128,
        start_time: u64,
        cliff_time: u64,
        end_time: u64,
        milestones: Vec<Milestone>,
        options: StreamOptions,
    ) -> Result<u64, Error> {
        let StreamOptions {
            curve_type,
            is_soulbound,
            vault_address,
        } = options;

        // Validate time range
        if start_time >= end_time {
            return Err(Error::InvalidTimeRange);
        }
        if total_amount <= 0 {
            return Err(Error::InvalidAmount);
        }
        if Self::is_address_restricted(env.clone(), receiver.clone()) {
            soroban_sdk::panic_with_error!(&env, Error::AddressRestricted);
        }

        // Validate cliff period
        if cliff_time < start_time || cliff_time > end_time {
            panic!("Cliff time must be between start and end time");
        }

        // Validate vault if provided
        let vault_shares = if let Some(ref vault) = vault_address {
            // Transfer tokens to contract first
            let token_client = token::Client::new(&env, &token);
            token_client.transfer(&sender, &env.current_contract_address(), &total_amount);

            // Deposit to vault and get shares
            vault::deposit_to_vault(&env, vault, &token, total_amount)
                .map_err(|_| Error::InvalidAmount)?
        } else {
            // Standard stream without vault
            let token_client = token::Client::new(&env, &token);
            token_client.transfer(&sender, &env.current_contract_address(), &total_amount);
            0
        };

        let stream_id: u64 = env.storage().instance().get(&STREAM_COUNT).unwrap_or(0);
        let next_id = stream_id + 1;

        let stream = Stream {
            sender: sender.clone(),
            receiver: receiver.clone(),
            token: token.clone(),
            total_amount,
            start_time,
            cliff_time,
            end_time,
            withdrawn_amount: 0,
            interest_strategy: 0,
            vault_address: vault_address.clone(),
            deposited_principal: total_amount,
            metadata: None,
            withdrawn: 0,
            receipt_owner: receiver.clone(),
            paused_time: 0,
            total_paused_duration: 0,
            milestones,
            curve_type,
            is_usd_pegged: false,
            usd_amount: 0,
            oracle_address: sender.clone(),
            oracle_max_staleness: 0,
            price_min: 0,
            price_max: 0,
            is_soulbound,
            clawback_enabled: false, // TODO: Check token flags
            arbiter: None,
            is_frozen: false,
            state: StreamState::Active,
        };

        let stream_key = (STREAM_COUNT, stream_id);

        // Extend contract instance TTL to ensure long-term accessibility
        // TTL extension removed

        env.storage().instance().set(&stream_key, &stream);
        env.storage().instance().set(&STREAM_COUNT, &next_id);

        // Store vault shares if vault is used
        if vault_shares > 0 {
            env.storage()
                .instance()
                .set(&DataKey::VaultShares(stream_id), &vault_shares);
        }

        // If soulbound, emit event and add to index
        if is_soulbound {
            env.events().publish(
                (symbol_short!("soulbound"), symbol_short!("locked")),
                (stream_id, receiver.clone()),
            );

            // Add to soulbound streams index
            let mut soulbound_streams: Vec<u64> = env
                .storage()
                .persistent()
                .get(&DataKey::SoulboundStreams)
                .unwrap_or(Vec::new(&env));
            soulbound_streams.push_back(stream_id);
            env.storage()
                .persistent()
                .set(&DataKey::SoulboundStreams, &soulbound_streams);
        }

        Self::update_token_tvl(&env, token.clone(), total_amount);

        env.events().publish(
            (symbol_short!("create"), sender.clone()),
            StreamCreatedEvent {
                stream_id,
                sender: sender.clone(),
                receiver: receiver.clone(),
                token,
                total_amount,
                start_time,
                end_time,
                timestamp: env.ledger().timestamp(),
            },
        );
        Self::mint_receipt(&env, stream_id, &receiver);

        Ok(stream_id)
    }

    /// Maximum number of recipients allowed in a single batch call.
    /// Prevents exceeding the Stellar ledger's maximum transaction size.
    pub const MAX_RECIPIENTS: u32 = 120;

    /// Create multiple streams in a single call.
    ///
    /// This is not a loop over [`Self::create_stream`]: everything that would
    /// otherwise be repeated per item is hoisted out of the loop so the
    /// marginal cost of each extra stream in the batch is just its own
    /// storage write, receipt, and event.
    ///
    /// - **Single authorization check.** `sender.require_auth()` runs once for
    ///   the whole batch instead of once per stream.
    /// - **Fail-fast validation.** Every request (time range, amount, cliff
    ///   bounds, restricted receiver) is validated in a first pass, before any
    ///   storage write or token transfer happens. An invalid item anywhere in
    ///   the batch is rejected without having paid for the transfers or writes
    ///   of the items ahead of it.
    /// - **Cached restricted-address list.** The compliance list is read from
    ///   storage once and reused for every request instead of once per item.
    /// - **Cached stream counter.** `STREAM_COUNT` is read once, advanced in
    ///   memory for the whole batch, and written back once instead of on every
    ///   iteration.
    /// - **Bulk token transfer.** Every request's principal (vault-bound or
    ///   not) is summed and moved from `sender` to the contract in a single
    ///   token transfer instead of one transfer per stream. A per-item
    ///   transfer from the contract into its vault still happens for
    ///   vault-bound requests, since each may target a different vault.
    ///
    /// The `Stream` record and NFT-style receipt for each requested stream
    /// still require one storage write apiece — each occupies its own ledger
    /// entry and can't be merged — so per-item cost does not go to zero, but
    /// every cost that was previously duplicated across the batch is now paid
    /// exactly once.
    ///
    /// Returns `Error::BatchSizeExceeded` if the number of requests exceeds
    /// `MAX_RECIPIENTS`.
    pub fn create_batch_streams(
        env: Env,
        sender: Address,
        token: Address,
        requests: Vec<StreamRequest>,
    ) -> Result<Vec<u64>, Error> {
        if requests.len() > Self::MAX_RECIPIENTS {
            return Err(Error::BatchSizeExceeded);
        }

        sender.require_auth();

        if requests.is_empty() {
            return Ok(Vec::new(&env));
        }

        // Fail-fast validation pass: every request is checked, and the batch
        // total is computed, before anything is written or transferred.
        let restricted = Self::restricted_addresses(&env);
        let mut total_amount: i128 = 0;
        for req in requests.iter() {
            if req.start_time >= req.end_time {
                return Err(Error::InvalidTimeRange);
            }
            if req.amount <= 0 {
                return Err(Error::InvalidAmount);
            }
            if req.cliff_time < req.start_time || req.cliff_time > req.end_time {
                panic!("Cliff time must be between start and end time");
            }
            if restricted.contains(&req.receiver) {
                soroban_sdk::panic_with_error!(&env, Error::AddressRestricted);
            }
            total_amount += req.amount;
        }

        // One transfer covers every request's principal instead of one per item.
        let token_client = token::Client::new(&env, &token);
        token_client.transfer(&sender, &env.current_contract_address(), &total_amount);

        let mut next_id: u64 = env.storage().instance().get(&STREAM_COUNT).unwrap_or(0);
        let mut stream_ids: Vec<u64> = Vec::new(&env);

        for req in requests.iter() {
            let stream_id = next_id;
            next_id += 1;

            // Contract already holds the funds from the bulk transfer above;
            // vault-bound requests still need their own contract-to-vault leg.
            let vault_shares = if let Some(ref vault) = req.vault_address {
                vault::deposit_to_vault(&env, vault, &token, req.amount)
                    .map_err(|_| Error::InvalidAmount)?
            } else {
                0
            };

            let stream = Stream {
                sender: sender.clone(),
                receiver: req.receiver.clone(),
                token: token.clone(),
                total_amount: req.amount,
                start_time: req.start_time,
                cliff_time: req.cliff_time,
                end_time: req.end_time,
                withdrawn_amount: 0,
                interest_strategy: 0,
                vault_address: req.vault_address.clone(),
                deposited_principal: req.amount,
                metadata: None,
                withdrawn: 0,
                receipt_owner: req.receiver.clone(),
                paused_time: 0,
                total_paused_duration: 0,
                milestones: Vec::new(&env),
                curve_type: CurveType::Linear,
                is_usd_pegged: false,
                usd_amount: 0,
                oracle_address: sender.clone(),
                oracle_max_staleness: 0,
                price_min: 0,
                price_max: 0,
                is_soulbound: false,
                clawback_enabled: false,
                arbiter: None,
                is_frozen: false,
                state: StreamState::Active,
            };

            env.storage()
                .instance()
                .set(&(STREAM_COUNT, stream_id), &stream);

            if vault_shares > 0 {
                env.storage()
                    .instance()
                    .set(&DataKey::VaultShares(stream_id), &vault_shares);
            }

            env.events().publish(
                (symbol_short!("create"), sender.clone()),
                StreamCreatedEvent {
                    stream_id,
                    sender: sender.clone(),
                    receiver: req.receiver.clone(),
                    token: token.clone(),
                    total_amount: req.amount,
                    start_time: req.start_time,
                    end_time: req.end_time,
                    timestamp: env.ledger().timestamp(),
                },
            );
            Self::mint_receipt(&env, stream_id, &req.receiver);

            stream_ids.push_back(stream_id);
        }

        env.storage().instance().set(&STREAM_COUNT, &next_id);

        Ok(stream_ids)
    }

    pub fn initialize(env: Env, admin: Address) {
        admin.require_auth();

        // Set admin role
        env.storage().instance().set(&DataKey::Admin, &admin);

        // Grant all roles to admin
        env.storage()
            .instance()
            .set(&DataKey::Role(admin.clone(), Role::SuperAdmin), &true);
        env.storage()
            .instance()
            .set(&DataKey::Role(admin.clone(), Role::Guardian), &true);
        env.storage().instance().set(
            &DataKey::Role(admin.clone(), Role::FinancialOperator),
            &true,
        );
    }

    // ========== RBAC Functions ==========

    /// Grant a role to an address (SuperAdmin only)
    pub fn grant_role(env: Env, admin: Address, target: Address, role: Role) {
        admin.require_auth();

        // Check if caller has SuperAdmin role
        if !Self::has_role(&env, &admin, Role::SuperAdmin) {
            soroban_sdk::panic_with_error!(&env, Error::Unauthorized);
        }

        // Grant the role
        env.storage()
            .instance()
            .set(&DataKey::Role(target.clone(), role), &true);

        // Emit event
        env.events().publish((symbol_short!("grant"), target), role);
    }

    /// Revoke a role from an address (SuperAdmin only)
    pub fn revoke_role(env: Env, admin: Address, target: Address, role: Role) {
        admin.require_auth();

        // Check if caller has SuperAdmin role
        if !Self::has_role(&env, &admin, Role::SuperAdmin) {
            soroban_sdk::panic_with_error!(&env, Error::Unauthorized);
        }

        // Revoke the role
        env.storage()
            .instance()
            .remove(&DataKey::Role(target.clone(), role));

        // Emit event
        env.events()
            .publish((symbol_short!("revoke"), target), role);
    }

    /// Check if an address has a specific role
    pub fn check_role(env: Env, address: Address, role: Role) -> bool {
        Self::has_role(&env, &address, role)
    }

    /// Internal helper to check if an address has a role
    fn has_role(env: &Env, address: &Address, role: Role) -> bool {
        env.storage()
            .instance()
            .get(&DataKey::Role(address.clone(), role))
            .unwrap_or(false)
    }

    // ========== Contract Upgrade Functions ==========

    /// Upgrade the contract to a new WASM hash
    /// Only addresses with Admin role can perform this operation
    pub fn upgrade(env: Env, admin: Address, new_wasm_hash: soroban_sdk::BytesN<32>) {
        admin.require_auth();

        // Check if caller has Admin role
        if !Self::has_role(&env, &admin, Role::SuperAdmin) {
            return; // Error::Unauthorized;
        }

        // Update the contract WASM
        env.deployer()
            .update_current_contract_wasm(new_wasm_hash.clone());

        // Emit upgrade event with new WASM hash
        env.events()
            .publish((symbol_short!("upgrade"), admin), new_wasm_hash);
    }

    /// Get the current admin address (for backward compatibility)
    pub fn get_admin(env: Env) -> Address {
        env.storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("Admin not set")
    }

    pub fn restrict_address(env: Env, admin: Address, address: Address) {
        admin.require_auth();
        let has_admin: bool = env
            .storage()
            .instance()
            .get(&DataKey::Role(admin, Role::SuperAdmin))
            .unwrap_or(false);
        if !has_admin {
            soroban_sdk::panic_with_error!(&env, Error::Unauthorized);
        }
        let mut list: Vec<Address> = env
            .storage()
            .instance()
            .get(&RESTRICTED_ADDRESSES)
            .unwrap_or(Vec::new(&env));
        if !list.contains(address.clone()) {
            list.push_back(address);
            env.storage().instance().set(&RESTRICTED_ADDRESSES, &list);
        }
    }

    pub fn is_address_restricted(env: Env, address: Address) -> bool {
        Self::restricted_addresses(&env).contains(&address)
    }

    /// Load the restricted-address list once. Callers that need to check
    /// several addresses (e.g. batch validation) should reuse the returned
    /// `Vec` instead of re-reading storage per address.
    fn restricted_addresses(env: &Env) -> Vec<Address> {
        env.storage()
            .instance()
            .get(&RESTRICTED_ADDRESSES)
            .unwrap_or(Vec::new(env))
    }

    pub fn unrestrict_address(env: Env, admin: Address, address: Address) {
        admin.require_auth();
        let has_admin: bool = env
            .storage()
            .instance()
            .get(&DataKey::Role(admin, Role::SuperAdmin))
            .unwrap_or(false);
        if !has_admin {
            soroban_sdk::panic_with_error!(&env, Error::Unauthorized);
        }
        let list: Vec<Address> = env
            .storage()
            .instance()
            .get(&RESTRICTED_ADDRESSES)
            .unwrap_or(Vec::new(&env));
        let mut new_list = Vec::new(&env);
        for a in list.iter() {
            if a != address {
                new_list.push_back(a.clone());
            }
        }
        env.storage()
            .instance()
            .set(&RESTRICTED_ADDRESSES, &new_list);
    }

    pub fn get_restricted_addresses(env: Env) -> Vec<Address> {
        env.storage()
            .instance()
            .get(&RESTRICTED_ADDRESSES)
            .unwrap_or(Vec::new(&env))
    }

    /// Returns true if the given vault address is in the approved vaults list.
    pub fn is_vault_approved(env: Env, vault: Address) -> bool {
        let approved: Vec<Address> = env
            .storage()
            .instance()
            .get(&DataKey::ApprovedVaults)
            .unwrap_or(Vec::new(&env));
        approved.contains(vault)
    }

    /// Extend instance storage TTL so long-lived streams remain accessible.
    #[allow(dead_code)]
    fn extend_contract_ttl(env: &Env) {
        const EXTEND_LEDGERS: u32 = 6_000_000; // ~1 year at 5s/ledger
        env.storage()
            .instance()
            .extend_ttl(EXTEND_LEDGERS, EXTEND_LEDGERS);
    }

    fn mint_receipt(env: &Env, stream_id: u64, owner: &Address) {
        let receipt = StreamReceipt {
            stream_id,
            owner: owner.clone(),
            minted_at: env.ledger().timestamp(),
        };
        env.storage()
            .instance()
            .set(&(RECEIPT, stream_id), &receipt);
    }

    pub fn get_stream(env: Env, stream_id: u64) -> Result<Stream, Error> {
        env.storage()
            .instance()
            .get(&(STREAM_COUNT, stream_id))
            .ok_or(Error::StreamNotFound)
    }

    pub fn get_stream_remaining_time(env: Env, stream_id: u64) -> Result<u64, Error> {
        let stream: Stream = env
            .storage()
            .instance()
            .get(&(STREAM_COUNT, stream_id))
            .ok_or(Error::StreamNotFound)?;

        let current_time = env.ledger().timestamp();

        if current_time >= stream.end_time {
            Ok(0)
        } else {
            Ok(stream.end_time - current_time)
        }
    }

    pub fn is_stream_active(env: Env, stream_id: u64) -> bool {
        let stream: Option<Stream> = env.storage().instance().get(&(STREAM_COUNT, stream_id));

        match stream {
            None => false,
            Some(s) => {
                let current_time = env.ledger().timestamp();
                s.state == StreamState::Active && !s.is_frozen && current_time < s.end_time
            }
        }
    }

    pub fn get_soulbound_streams(env: Env) -> Vec<u64> {
        env.storage()
            .persistent()
            .get(&DataKey::SoulboundStreams)
            .unwrap_or(Vec::new(&env))
    }

    pub fn transfer_receiver(
        env: Env,
        stream_id: u64,
        caller: Address,
        new_receiver: Address,
    ) -> Result<(), Error> {
        caller.require_auth();

        let stream_key = (STREAM_COUNT, stream_id);
        let mut stream: Stream = env
            .storage()
            .instance()
            .get(&stream_key)
            .ok_or(Error::StreamNotFound)?;

        // SOULBOUND CHECK FIRST
        if stream.is_soulbound {
            return Err(Error::StreamIsSoulbound);
        }

        // Authorization check: only sender can transfer receiver
        if stream.sender != caller {
            return Err(Error::Unauthorized);
        }

        if stream.state == StreamState::Closed {
            return Err(Error::AlreadyCancelled);
        }

        // Update receiver
        stream.receiver = new_receiver.clone();
        env.storage().instance().set(&stream_key, &stream);

        Ok(())
    }

    /// Top up an active stream with additional funds
    pub fn top_up_stream(
        env: Env,
        stream_id: u64,
        sender: Address,
        amount: i128,
    ) -> Result<(), Error> {
        sender.require_auth();

        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }

        let key = (STREAM_COUNT, stream_id);
        let mut stream: Stream = env
            .storage()
            .instance()
            .get(&key)
            .ok_or(Error::StreamNotFound)?;

        if stream.sender != sender {
            return Err(Error::Unauthorized);
        }

        if stream.state == StreamState::Closed {
            return Err(Error::AlreadyCancelled);
        }

        let current_time = env.ledger().timestamp();
        if current_time >= stream.end_time {
            return Err(Error::InvalidAmount);
        }

        // Transfer tokens from sender
        let token_client = token::Client::new(&env, &stream.token);
        token_client.transfer(&sender, &env.current_contract_address(), &amount);

        // Calculate new end time based on flow rate
        let total_duration = stream.end_time.saturating_sub(stream.start_time);
        let flow_rate = stream.total_amount / total_duration as i128;

        let new_total = stream.total_amount + amount;
        let additional_duration = amount / flow_rate;
        let new_end_time = stream.end_time + additional_duration as u64;

        stream.total_amount = new_total;
        stream.end_time = new_end_time;
        env.storage().instance().set(&key, &stream);

        Self::update_token_tvl(&env, stream.token.clone(), amount);

        env.events().publish(
            (symbol_short!("topup"), stream_id),
            types::StreamToppedUpEvent {
                stream_id,
                sender,
                amount,
                new_total,
                new_end_time,
                timestamp: current_time,
            },
        );

        Ok(())
    }

    pub fn pause_stream(env: Env, stream_id: u64, caller: Address) -> Result<(), Error> {
        caller.require_auth();

        let key = (STREAM_COUNT, stream_id);
        let mut stream: Stream = env
            .storage()
            .instance()
            .get(&key)
            .ok_or(Error::StreamNotFound)?;

        if stream.sender != caller {
            return Err(Error::Unauthorized);
        }
        if stream.state == StreamState::Closed {
            return Err(Error::AlreadyCancelled);
        }
        if stream.state == StreamState::Paused {
            return Ok(());
        }

        stream.state = StreamState::Paused;
        stream.paused_time = env.ledger().timestamp();
        env.storage().instance().set(&key, &stream);

        env.events().publish(
            (symbol_short!("pause"), stream_id),
            types::StreamPausedEvent {
                stream_id,
                pauser: caller,
                timestamp: env.ledger().timestamp(),
            },
        );

        Ok(())
    }

    /// Resume a paused stream (alias for backward compatibility).
    /// Equivalent to `resume_stream`.
    pub fn unpause_stream(env: Env, stream_id: u64, caller: Address) -> Result<(), Error> {
        Self::resume_stream(env, stream_id, caller)
    }

    /// Resume a paused stream, restoring time-based vesting.
    /// Only the sender can resume a stream.
    pub fn resume_stream(env: Env, stream_id: u64, caller: Address) -> Result<(), Error> {
        caller.require_auth();

        let key = (STREAM_COUNT, stream_id);
        let mut stream: Stream = env
            .storage()
            .instance()
            .get(&key)
            .ok_or(Error::StreamNotFound)?;

        if stream.sender != caller {
            return Err(Error::Unauthorized);
        }
        if stream.state == StreamState::Closed {
            return Err(Error::AlreadyCancelled);
        }
        if stream.state != StreamState::Paused {
            return Err(Error::StreamNotPaused);
        }

        let current_time = env.ledger().timestamp();
        let pause_duration = current_time - stream.paused_time;
        stream.total_paused_duration += pause_duration;
        stream.state = StreamState::Active;
        stream.paused_time = 0;

        env.storage().instance().set(&key, &stream);

        env.events().publish(
            (symbol_short!("resume"), stream_id),
            StreamResumedEvent {
                stream_id,
                resumer: caller,
                paused_duration: pause_duration,
                timestamp: current_time,
            },
        );

        Ok(())
    }

    pub fn withdraw(env: Env, stream_id: u64, caller: Address) -> Result<i128, Error> {
        caller.require_auth();

        let key = (STREAM_COUNT, stream_id);
        let mut stream: Stream = env
            .storage()
            .instance()
            .get(&key)
            .ok_or(Error::StreamNotFound)?;

        if stream.receiver != caller {
            return Err(Error::Unauthorized);
        }

        if stream.state == StreamState::Closed {
            return Err(Error::AlreadyCancelled);
        }
        if stream.state == StreamState::Paused {
            return Err(Error::StreamPaused);
        }

        let current_time = env.ledger().timestamp();
        let unlocked = Self::calculate_unlocked(&stream, current_time);
        let to_withdraw = unlocked - stream.withdrawn_amount;

        if to_withdraw <= 0 {
            return Err(Error::InsufficientBalance);
        }

        stream.withdrawn_amount += to_withdraw;

        if stream.withdrawn_amount >= stream.total_amount {
            stream.state = StreamState::Closed;
        }

        env.storage().instance().set(&key, &stream);

        Self::update_token_tvl(&env, stream.token.clone(), -to_withdraw);

        let token_client = token::Client::new(&env, &stream.token);
        token_client.transfer(
            &env.current_contract_address(),
            &stream.receiver,
            &to_withdraw,
        );

        Ok(to_withdraw)
    }

    /// Withdraw unlocked funds from multiple streams owned by `caller` in a
    /// single call.
    ///
    /// Applies the same gas optimizations as [`Self::create_batch_streams`],
    /// tuned for the fact that on Soroban a host-managed [`Vec`] read or
    /// write is itself a metered operation, not a free native one — so the
    /// optimization that matters most here is *not* allocating extra `Vec`s
    /// to stage per-stream data, on top of the ones the batch already needs:
    ///
    /// - **Single authorization check.** `caller.require_auth()` runs once
    ///   for the whole batch instead of once per stream.
    /// - **One pass, write-then-transfer per stream.** Each stream is loaded,
    ///   validated, and has its `withdrawn_amount` written in the same loop
    ///   — matching the checks-effects-interactions order [`Self::withdraw`]
    ///   already uses, so a reentrant call during a later transfer can't
    ///   double-spend a stream whose balance was already updated. Soroban
    ///   only commits storage writes if the whole invocation succeeds, so a
    ///   bad stream anywhere in the batch still leaves the ledger exactly as
    ///   if nothing had been written: failing fast doesn't require *staging*
    ///   the batch in extra `Vec`s before writing, just rejecting it before
    ///   any transfer is issued.
    /// - **Transfers grouped per token.** Streams that share a token are
    ///   summed into one running total (in a small `Vec` bounded by the
    ///   number of *distinct* tokens, not by batch size) and paid out with a
    ///   single transfer, since the destination (`caller`) is the same for
    ///   all of them.
    ///
    /// Each stream's `withdrawn_amount` still requires its own storage write
    /// (each stream is an independent ledger entry), so per-item cost does
    /// not go to zero, but authorization and same-token transfers are now
    /// paid for once instead of once per stream.
    ///
    /// Unlike [`Self::create_batch_streams`], this function's win doesn't
    /// show up as a large drop in the CPU-instruction benchmarks in
    /// `bench_test.rs`: per-stream storage I/O is the dominant, irreducible
    /// cost here, and those benchmarks run under `mock_all_auths`, which
    /// makes the auth-check consolidation look free even though real
    /// signature verification is not. The real savings — one token-contract
    /// invocation instead of `N` for a same-token batch, and one set of auth
    /// entries instead of `N` in the transaction envelope — are measured
    /// directly (by event count) in
    /// `bench_batch_withdraw_emits_one_transfer_event_per_distinct_token`.
    ///
    /// Returns the amount withdrawn from each stream, in the same order as
    /// `stream_ids`. Returns `Error::BatchSizeExceeded` if `stream_ids`
    /// exceeds `MAX_RECIPIENTS`.
    pub fn batch_withdraw(
        env: Env,
        caller: Address,
        stream_ids: Vec<u64>,
    ) -> Result<Vec<i128>, Error> {
        if stream_ids.len() > Self::MAX_RECIPIENTS {
            return Err(Error::BatchSizeExceeded);
        }

        caller.require_auth();

        if stream_ids.is_empty() {
            return Ok(Vec::new(&env));
        }

        let current_time = env.ledger().timestamp();

        // Validate, write, and group-by-token in one pass. Writes happen
        // before any transfer below, so a reentrant call can't observe a
        // stream whose balance hasn't been updated yet.
        let mut amounts: Vec<i128> = Vec::new(&env);
        let mut tokens: Vec<Address> = Vec::new(&env);
        let mut totals: Vec<i128> = Vec::new(&env);
        for stream_id in stream_ids.iter() {
            let mut stream: Stream = env
                .storage()
                .instance()
                .get(&(STREAM_COUNT, stream_id))
                .ok_or(Error::StreamNotFound)?;

            if stream.receiver != caller {
                return Err(Error::Unauthorized);
            }
            if stream.state == StreamState::Closed {
                return Err(Error::AlreadyCancelled);
            }
            if stream.state == StreamState::Paused {
                return Err(Error::StreamPaused);
            }

            let unlocked = Self::calculate_unlocked(&stream, current_time);
            let to_withdraw = unlocked - stream.withdrawn_amount;
            if to_withdraw <= 0 {
                return Err(Error::InsufficientBalance);
            }

            stream.withdrawn_amount += to_withdraw;
            let token = stream.token.clone();
            env.storage()
                .instance()
                .set(&(STREAM_COUNT, stream_id), &stream);

            match tokens.iter().position(|t| t == token) {
                Some(idx) => {
                    let running = totals.get(idx as u32).unwrap();
                    totals.set(idx as u32, running + to_withdraw);
                }
                None => {
                    tokens.push_back(token);
                    totals.push_back(to_withdraw);
                }
            }

            amounts.push_back(to_withdraw);
        }

        for i in 0..tokens.len() {
            let token = tokens.get(i).unwrap();
            let total = totals.get(i).unwrap();
            let token_client = token::Client::new(&env, &token);
            token_client.transfer(&env.current_contract_address(), &caller, &total);
        }

        Ok(amounts)
    }

    pub fn cancel(env: Env, stream_id: u64, caller: Address) -> Result<(), Error> {
        caller.require_auth();

        let key = (STREAM_COUNT, stream_id);
        let mut stream: Stream = env
            .storage()
            .instance()
            .get(&key)
            .ok_or(Error::StreamNotFound)?;

        if stream.sender != caller && stream.receiver != caller {
            return Err(Error::Unauthorized);
        }
        if stream.state == StreamState::Closed {
            return Err(Error::AlreadyCancelled);
        }

        let current_time = env.ledger().timestamp();
        let unlocked = Self::calculate_unlocked(&stream, current_time);
        let to_receiver = unlocked - stream.withdrawn_amount;
        let to_sender = stream.total_amount - unlocked;

        let remaining = stream.total_amount - stream.withdrawn_amount;

        stream.state = StreamState::Closed;
        stream.withdrawn_amount = unlocked;
        env.storage().instance().set(&key, &stream);

        Self::update_token_tvl(&env, stream.token.clone(), -remaining);

        let token_client = token::Client::new(&env, &stream.token);
        if to_receiver > 0 {
            token_client.transfer(
                &env.current_contract_address(),
                &stream.receiver,
                &to_receiver,
            );
        }
        if to_sender > 0 {
            token_client.transfer(&env.current_contract_address(), &stream.sender, &to_sender);
        }

        Ok(())
    }

    /// Optimized cancel for bridge migration.
    /// Returns the total remaining balance (earned + unearned) and transfers it to the receiver.
    pub fn cancel_stream(env: Env, stream_id: u64, caller: Address) -> Result<i128, Error> {
        caller.require_auth();

        let key = (STREAM_COUNT, stream_id);
        let mut stream: Stream = env
            .storage()
            .instance()
            .get(&key)
            .ok_or(Error::StreamNotFound)?;

        if stream.receiver != caller {
            return Err(Error::Unauthorized);
        }
        if stream.state == StreamState::Closed {
            return Err(Error::AlreadyCancelled);
        }

        let remaining = stream.total_amount - stream.withdrawn_amount;

        stream.state = StreamState::Closed;
        stream.withdrawn_amount = stream.total_amount;
        env.storage().instance().set(&key, &stream);

        Self::update_token_tvl(&env, stream.token.clone(), -remaining);

        if remaining > 0 {
            let token_client = token::Client::new(&env, &stream.token);
            token_client.transfer(
                &env.current_contract_address(),
                &stream.receiver,
                &remaining,
            );
        }

        Ok(remaining)
    }

    fn calculate_unlocked(stream: &Stream, current_time: u64) -> i128 {
        if current_time <= stream.start_time {
            return 0;
        }

        let mut effective_time = current_time;
        if stream.state == StreamState::Paused {
            effective_time = stream.paused_time;
        }

        let adjusted_cliff = stream.cliff_time + stream.total_paused_duration;
        if effective_time < adjusted_cliff {
            return 0;
        }

        let adjusted_end = stream.end_time + stream.total_paused_duration;
        if effective_time >= adjusted_end {
            return stream.total_amount;
        }

        let elapsed = (effective_time - stream.start_time) as i128;
        let paused = stream.total_paused_duration as i128;
        let effective_elapsed = elapsed - paused;

        if effective_elapsed <= 0 {
            return 0;
        }

        let duration = (stream.end_time - stream.start_time) as i128;

        // Calculate base unlocked amount based on curve type
        match stream.curve_type {
            CurveType::Linear => (stream.total_amount * effective_elapsed) / duration,
            CurveType::Exponential => {
                // Use exponential curve with overflow protection
                let adjusted_start = stream.start_time;
                let adjusted_current = stream.start_time + effective_elapsed as u64;

                math::calculate_exponential_unlocked(
                    stream.total_amount,
                    adjusted_start,
                    stream.end_time,
                    adjusted_current,
                )
                .unwrap_or((stream.total_amount * effective_elapsed) / duration)
            }
        }
    }

    fn update_token_tvl(env: &Env, token: Address, delta: i128) {
        let key = (storage::TOKEN_TVL, token);
        let mut tvl: i128 = env.storage().instance().get(&key).unwrap_or(0);
        tvl += delta;
        env.storage().instance().set(&key, &tvl);
    }

    /// Query the total value locked for a specific token across all active streams.
    ///
    /// TVL is calculated as the sum of remaining locked amounts (total_amount - withdrawn_amount)
    /// for every non-closed stream denominated in the given token.
    pub fn get_token_tvl(env: Env, token: Address) -> i128 {
        env.storage()
            .instance()
            .get(&(storage::TOKEN_TVL, token))
            .unwrap_or(0)
    }

    /// Query the total value locked for all tokens across all active streams.
    ///
    /// Returns a map where each key is a token address with a non-zero TVL and the value is the
    /// total locked amount for that token. Only non-closed streams are counted.
    pub fn get_all_tokens_tvl(env: Env) -> Map<Address, i128> {
        let stream_count: u64 = env.storage().instance().get(&STREAM_COUNT).unwrap_or(0);
        let mut tvl_map = Map::new(&env);

        for stream_id in 0..stream_count {
            let key = (STREAM_COUNT, stream_id);
            if let Some(stream) = env.storage().instance().get::<_, Stream>(&key) {
                if stream.state != StreamState::Closed {
                    let remaining = stream.total_amount - stream.withdrawn_amount;
                    if remaining > 0 {
                        let current = tvl_map.get(stream.token.clone()).unwrap_or(0);
                        tvl_map.set(stream.token.clone(), current + remaining);
                    }
                }
            }
        }

        tvl_map
    }

    // --- CONTRIBUTOR PULL-REQUEST PAYMENTS ---

    pub fn create_request(
        env: Env,
        receiver: Address,
        token: Address,
        total_amount: i128,
        duration: u64,
        metadata: Option<soroban_sdk::BytesN<32>>,
    ) -> u64 {
        receiver.require_auth();
        let count: u64 = env
            .storage()
            .instance()
            .get(&RequestKey::RequestCount)
            .unwrap_or(0);
        let request_id = count + 1;
        let now = env.ledger().timestamp();
        let request = ContributorRequest {
            id: request_id,
            receiver: receiver.clone(),
            token: token.clone(),
            total_amount,
            duration,
            start_time: now,
            status: RequestStatus::Pending,
            metadata,
        };
        env.storage()
            .instance()
            .set(&RequestKey::Request(request_id), &request);
        env.storage()
            .instance()
            .set(&RequestKey::RequestCount, &request_id);
        env.events().publish(
            (soroban_sdk::Symbol::new(&env, "RequestCreated"), request_id),
            RequestCreatedEvent {
                request_id,
                receiver,
                token,
                total_amount,
                duration,
                timestamp: now,
            },
        );
        request_id
    }

    pub fn execute_request(env: Env, admin: Address, request_id: u64) -> Result<u64, Error> {
        admin.require_auth();
        if !Self::has_role(&env, &admin, Role::SuperAdmin) {
            return Err(Error::Unauthorized);
        }
        let mut request: ContributorRequest = env
            .storage()
            .instance()
            .get(&RequestKey::Request(request_id))
            .ok_or(Error::StreamNotFound)?;
        if request.status != RequestStatus::Pending {
            return Err(Error::AlreadyExecuted);
        }

        // Create the stream first (using the non-authorizing helper, since
        // `admin` is already authenticated above) and only mark the request
        // approved once the stream has been created successfully.
        let milestones: Vec<Milestone> = Vec::new(&env);
        let options = StreamOptions {
            curve_type: CurveType::Linear,
            is_soulbound: false,
            vault_address: None,
        };
        let stream_id = Self::create_stream_internal(
            env.clone(),
            admin.clone(),
            request.receiver.clone(),
            request.token.clone(),
            request.total_amount,
            request.start_time,
            request.start_time, // cliff_time: no cliff
            request.start_time + request.duration,
            milestones,
            options,
        )?;

        request.status = RequestStatus::Approved;
        env.storage()
            .instance()
            .set(&RequestKey::Request(request_id), &request);
        env.events().publish(
            (
                soroban_sdk::Symbol::new(&env, "RequestExecuted"),
                request_id,
            ),
            RequestExecutedEvent {
                request_id,
                stream_id,
                executor: admin,
                timestamp: env.ledger().timestamp(),
            },
        );
        Ok(stream_id)
    }

    pub fn get_request(env: Env, request_id: u64) -> Option<ContributorRequest> {
        env.storage()
            .instance()
            .get(&RequestKey::Request(request_id))
    }

    // ========== OFAC Compliance Functions ==========

    /// Internal helper: validate receiver is not restricted
    fn validate_receiver(env: &Env, receiver: &Address) -> Result<(), Error> {
        let list: Vec<Address> = env
            .storage()
            .instance()
            .get(&RESTRICTED_ADDRESSES)
            .unwrap_or_else(|| Vec::new(env));
        for existing in list.iter() {
            if &existing == receiver {
                return Err(Error::ReceiverRestricted);
            }
        }
        Ok(())
    }

    pub fn get_proposal(env: Env, proposal_id: u64) -> Option<StreamProposal> {
        env.storage().instance().get(&(PROPOSAL_COUNT, proposal_id))
    }

    pub fn get_receipt(env: Env, stream_id: u64) -> Option<StreamReceipt> {
        env.storage().instance().get(&(RECEIPT, stream_id))
    }

    pub fn get_receipt_metadata(env: Env, stream_id: u64) -> Result<ReceiptMetadata, Error> {
        let stream: Stream = env
            .storage()
            .instance()
            .get(&(STREAM_COUNT, stream_id))
            .ok_or(Error::StreamNotFound)?;
        let current_time = env.ledger().timestamp();
        let unlocked = Self::calculate_unlocked(&stream, current_time);
        let locked = stream.total_amount - unlocked;
        Ok(ReceiptMetadata {
            stream_id,
            locked_balance: locked,
            unlocked_balance: unlocked,
            total_amount: stream.total_amount,
            token: stream.token,
        })
    }

    pub fn transfer_receipt(
        env: Env,
        stream_id: u64,
        caller: Address,
        new_owner: Address,
    ) -> Result<(), Error> {
        caller.require_auth();
        if Self::is_address_restricted(env.clone(), new_owner.clone()) {
            soroban_sdk::panic_with_error!(&env, Error::AddressRestricted);
        }
        let key = (RECEIPT, stream_id);
        let mut receipt: StreamReceipt = env
            .storage()
            .instance()
            .get(&key)
            .ok_or(Error::StreamNotFound)?;
        if receipt.owner != caller {
            return Err(Error::NotReceiptOwner);
        }
        receipt.owner = new_owner.clone();
        env.storage().instance().set(&key, &receipt);
        let stream_key = (STREAM_COUNT, stream_id);
        let mut stream: Stream = env
            .storage()
            .instance()
            .get(&stream_key)
            .ok_or(Error::StreamNotFound)?;
        stream.receipt_owner = new_owner;
        env.storage().instance().set(&stream_key, &stream);
        Ok(())
    }
}

// Contract metadata for explorer display (Stellar.Expert, etc.)
soroban_sdk::contractmeta!(
    key = "Description",
    val = "StellarStream: Token streaming with multi-sig proposals, dynamic vesting curves (linear/exponential), yield optimization, and OFAC compliance"
);
soroban_sdk::contractmeta!(key = "Version", val = "0.1.0");
soroban_sdk::contractmeta!(key = "Name", val = "StellarStream");

