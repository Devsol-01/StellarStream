#![no_std]
use soroban_sdk::{
    contract, contractimpl, contracttype, token, Address, Env, String as SorString, Vec,
};

mod errors;
mod events;
mod storage;

use errors::Error;
use events::{
    emit_dispute_raised, emit_dispute_resolved, emit_escrow_created, emit_escrow_funded,
    emit_escrow_refunded, emit_escrow_released,
};
use storage::DataKey;

// Issue #1387 — Formal verification: specs and runner
#[cfg(any(test, feature = "formal-verification"))]
pub mod formal_spec;
#[cfg(test)]
mod verify;

#[cfg(test)]
mod test;

// ── Type definitions ──────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone, PartialEq)]
pub enum EscrowState {
    PendingFunding,
    Active,
    Released,
    Disputed,
    Refunded,
    Cancelled,
}

#[contracttype]
#[derive(Clone, PartialEq)]
pub enum PartyRole {
    Depositor,
    Recipient,
    Arbiter,
}

#[contracttype]
#[derive(Clone, PartialEq)]
pub enum ReleaseCondition {
    TimeLock { release_timestamp: u64 },
    MultiSig { approvers: Vec<Address>, threshold: u32 },
    Milestone { description: SorString },
}

#[contracttype]
#[derive(Clone)]
pub struct EscrowData {
    pub state: EscrowState,
    pub depositor: Address,
    pub recipient: Address,
    pub arbiter: Option<Address>,
    pub token: Address,
    pub amount: i128,
    pub condition: ReleaseCondition,
    pub expires_at: Option<u64>,
    pub created_at: u64,
}

#[contracttype]
#[derive(Clone)]
pub struct DisputeData {
    pub raised_by: Address,
    pub reason: SorString,
    pub resolved: bool,
    pub resolution: u32, // 0 = unresolved, 1 = release, 2 = refund
    pub resolved_by: Option<Address>,
}

// ── Contract ──────────────────────────────────────────────────────────────────

#[contract]
pub struct EscrowContract;

#[contractimpl]
impl EscrowContract {
    // ── Initialization ────────────────────────────────────────────────────────

    pub fn initialize(env: Env, admin: Address, token: Address) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("already initialized");
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Token, &token);
        env.storage().instance().set(&DataKey::NextEscrowId, &1u64);
    }

    pub fn upgrade(env: Env, new_wasm_hash: BytesN<32>) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();
        env.deployer().update_current_contract_wasm(new_wasm_hash);
    }

    // ── Escrow creation ───────────────────────────────────────────────────────

    pub fn create_escrow(
        env: Env,
        depositor: Address,
        recipient: Address,
        arbiter: Option<Address>,
        amount: i128,
        condition: ReleaseCondition,
        expires_at: Option<u64>,
    ) -> u64 {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();

        if amount <= 0 {
            panic!("invalid amount");
        }

        let escrow_id: u64 = env.storage().instance().get(&DataKey::NextEscrowId).unwrap();
        env.storage()
            .instance()
            .set(&DataKey::NextEscrowId, &(escrow_id + 1));

        let escrow = EscrowData {
            state: EscrowState::PendingFunding,
            depositor: depositor.clone(),
            recipient: recipient.clone(),
            arbiter: arbiter.clone(),
            token: env.storage().instance().get(&DataKey::Token).unwrap(),
            amount,
            condition: condition.clone(),
            expires_at,
            created_at: env.ledger().timestamp(),
        };

        env.storage().persistent().set(&DataKey::Escrow(escrow_id), &escrow);

        emit_escrow_created(&env, escrow_id, &depositor, &recipient, amount);
        escrow_id
    }

    // ── Funding ───────────────────────────────────────────────────────────────

    pub fn fund(env: Env, escrow_id: u64) {
        let mut escrow: EscrowData = env
            .storage()
            .persistent()
            .get(&DataKey::Escrow(escrow_id))
            .unwrap_or_else(|| panic!("escrow not found"));

        if escrow.state != EscrowState::PendingFunding {
            panic!("invalid state");
        }

        if let Some(expiry) = escrow.expires_at {
            if env.ledger().timestamp() > expiry {
                panic!("escrow expired");
            }
        }

        escrow.depositor.require_auth();

        let token_client = token::Client::new(&env, &escrow.token);
        token_client.transfer(&escrow.depositor, &env.current_contract_address(), &escrow.amount);

        escrow.state = EscrowState::Active;
        env.storage()
            .persistent()
            .set(&DataKey::Escrow(escrow_id), &escrow);

        emit_escrow_funded(&env, escrow_id, &escrow.depositor, escrow.amount);
    }

    // ── Release conditions check ─────────────────────────────────────────────

    fn check_release_condition(env: &Env, escrow: &EscrowData, escrow_id: u64) {
        match &escrow.condition {
            ReleaseCondition::TimeLock { release_timestamp } => {
                if env.ledger().timestamp() < *release_timestamp {
                    panic!("release time not yet reached");
                }
            }
            ReleaseCondition::MultiSig { approvers, threshold } => {
                let mut approval_count: u32 = 0;
                for approver in approvers.iter() {
                    if env
                        .storage()
                        .persistent()
                        .has(&DataKey::Approval(escrow_id, approver))
                    {
                        approval_count += 1;
                    }
                }
                if approval_count < *threshold {
                    panic!("quorum not reached");
                }
            }
            ReleaseCondition::Milestone { description: _ } => {
                // Milestone requires arbiter approval
                match &escrow.arbiter {
                    Some(arbiter) => {
                        if !env
                            .storage()
                            .persistent()
                            .has(&DataKey::Approval(escrow_id, arbiter))
                        {
                            panic!("milestone not verified by arbiter");
                        }
                    }
                    None => panic!("no arbiter set for milestone condition"),
                }
            }
        }
    }

    // ── Approve release (for multi-sig / milestone) ─────────────────────────

    pub fn approve_release(env: Env, escrow_id: u64, approver: Address) {
        let escrow: EscrowData = env
            .storage()
            .persistent()
            .get(&DataKey::Escrow(escrow_id))
            .unwrap_or_else(|| panic!("escrow not found"));

        if escrow.state != EscrowState::Active {
            panic!("escrow not active");
        }

        approver.require_auth();

        // Verify the approver is a party or arbiter
        let is_party = approver == escrow.depositor
            || approver == escrow.recipient
            || escrow.arbiter.as_ref() == Some(&approver);

        if !is_party {
            panic!("not authorized to approve");
        }

        if env
            .storage()
            .persistent()
            .has(&DataKey::Approval(escrow_id, approver.clone()))
        {
            panic!("already approved");
        }

        env.storage()
            .persistent()
            .set(&DataKey::Approval(escrow_id, approver), &true);
    }

    // ── Release ───────────────────────────────────────────────────────────────

    pub fn release(env: Env, escrow_id: u64) {
        let mut escrow: EscrowData = env
            .storage()
            .persistent()
            .get(&DataKey::Escrow(escrow_id))
            .unwrap_or_else(|| panic!("escrow not found"));

        if escrow.state != EscrowState::Active {
            panic!("escrow not active");
        }

        Self::check_release_condition(&env, &escrow, escrow_id);

        escrow.recipient.require_auth();

        let token_client = token::Client::new(&env, &escrow.token);
        token_client.transfer(
            &env.current_contract_address(),
            &escrow.recipient,
            &escrow.amount,
        );

        escrow.state = EscrowState::Released;
        env.storage()
            .persistent()
            .set(&DataKey::Escrow(escrow_id), &escrow);

        emit_escrow_released(&env, escrow_id, &escrow.recipient, escrow.amount);
    }

    // ── Refund ────────────────────────────────────────────────────────────────

    pub fn refund(env: Env, escrow_id: u64) {
        let mut escrow: EscrowData = env
            .storage()
            .persistent()
            .get(&DataKey::Escrow(escrow_id))
            .unwrap_or_else(|| panic!("escrow not found"));

        if escrow.state != EscrowState::Active && escrow.state != EscrowState::Disputed {
            panic!("invalid state");
        }

        escrow.depositor.require_auth();

        let token_client = token::Client::new(&env, &escrow.token);
        token_client.transfer(
            &env.current_contract_address(),
            &escrow.depositor,
            &escrow.amount,
        );

        escrow.state = EscrowState::Refunded;
        env.storage()
            .persistent()
            .set(&DataKey::Escrow(escrow_id), &escrow);

        emit_escrow_refunded(&env, escrow_id, &escrow.depositor, escrow.amount);
    }

    // ── Dispute handling ─────────────────────────────────────────────────────

    pub fn raise_dispute(env: Env, escrow_id: u64, raised_by: Address, reason: SorString) {
        let mut escrow: EscrowData = env
            .storage()
            .persistent()
            .get(&DataKey::Escrow(escrow_id))
            .unwrap_or_else(|| panic!("escrow not found"));

        if escrow.state != EscrowState::Active {
            panic!("only active escrows can be disputed");
        }

        raised_by.require_auth();

        let is_party = raised_by == escrow.depositor
            || raised_by == escrow.recipient
            || escrow.arbiter.as_ref() == Some(&raised_by);

        if !is_party {
            panic!("only parties can raise disputes");
        }

        let dispute = DisputeData {
            raised_by: raised_by.clone(),
            reason,
            resolved: false,
            resolution: 0,
            resolved_by: None,
        };

        env.storage()
            .persistent()
            .set(&DataKey::Dispute(escrow_id), &dispute);

        escrow.state = EscrowState::Disputed;
        env.storage()
            .persistent()
            .set(&DataKey::Escrow(escrow_id), &escrow);

        emit_dispute_raised(&env, escrow_id, &raised_by);
    }

    pub fn resolve_dispute(
        env: Env,
        escrow_id: u64,
        resolution: u32, // 1 = release, 2 = refund
        resolved_by: Address,
    ) {
        let mut escrow: EscrowData = env
            .storage()
            .persistent()
            .get(&DataKey::Escrow(escrow_id))
            .unwrap_or_else(|| panic!("escrow not found"));

        if escrow.state != EscrowState::Disputed {
            panic!("escrow not in disputed state");
        }

        let mut dispute: DisputeData = env
            .storage()
            .persistent()
            .get(&DataKey::Dispute(escrow_id))
            .unwrap();

        if dispute.resolved {
            panic!("dispute already resolved");
        }

        // Only arbiter or admin can resolve
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        let is_authorized = resolved_by == admin
            || escrow.arbiter.as_ref() == Some(&resolved_by);

        if !is_authorized {
            resolved_by.require_auth();
            panic!("not authorized to resolve dispute");
        }

        resolved_by.require_auth();

        dispute.resolved = true;
        dispute.resolution = resolution;
        dispute.resolved_by = Some(resolved_by.clone());

        env.storage()
            .persistent()
            .set(&DataKey::Dispute(escrow_id), &dispute);

        let token_client = token::Client::new(&env, &escrow.token);

        if resolution == 1 {
            // Release to recipient
            token_client.transfer(
                &env.current_contract_address(),
                &escrow.recipient,
                &escrow.amount,
            );
            escrow.state = EscrowState::Released;
        } else if resolution == 2 {
            // Refund to depositor
            token_client.transfer(
                &env.current_contract_address(),
                &escrow.depositor,
                &escrow.amount,
            );
            escrow.state = EscrowState::Refunded;
        } else {
            panic!("invalid resolution");
        }

        env.storage()
            .persistent()
            .set(&DataKey::Escrow(escrow_id), &escrow);

        emit_dispute_resolved(&env, escrow_id, &resolution);
    }

    // ── Cancel (only unfunded) ────────────────────────────────────────────────

    pub fn cancel(env: Env, escrow_id: u64) {
        let mut escrow: EscrowData = env
            .storage()
            .persistent()
            .get(&DataKey::Escrow(escrow_id))
            .unwrap_or_else(|| panic!("escrow not found"));

        if escrow.state != EscrowState::PendingFunding {
            panic!("only unfunded escrows can be cancelled");
        }

        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();

        escrow.state = EscrowState::Cancelled;
        env.storage()
            .persistent()
            .set(&DataKey::Escrow(escrow_id), &escrow);
    }

    // ── Query ─────────────────────────────────────────────────────────────────

    pub fn get_escrow(env: Env, escrow_id: u64) -> Option<EscrowData> {
        env.storage()
            .persistent()
            .get(&DataKey::Escrow(escrow_id))
    }

    pub fn get_dispute(env: Env, escrow_id: u64) -> Option<DisputeData> {
        env.storage()
            .persistent()
            .get(&DataKey::Dispute(escrow_id))
    }

    pub fn get_approval(env: Env, escrow_id: u64, approver: Address) -> bool {
        env.storage()
            .persistent()
            .has(&DataKey::Approval(escrow_id, approver))
    }

    pub fn get_admin(env: Env) -> Address {
        env.storage().instance().get(&DataKey::Admin).unwrap()
    }

    pub fn get_token(env: Env) -> Address {
        env.storage().instance().get(&DataKey::Token).unwrap()
    }

    pub fn version() -> u32 {
        1
    }
}
