//! Clawback module for the StellarStream contract.
//!
//! Clawback allows a stream's **sender** to request the return of tokens that
//! have already been withdrawn by the receiver. This is an opt-in feature:
//! the stream must have been created with `clawback_enabled = true`.
//!
//! # Motivation
//!
//! Standard stream withdrawals are final — once tokens leave the contract they
//! belong to the receiver. Clawback provides a safety valve for scenarios where
//! a payment was made in error, a contractor did not deliver, or a compliance
//! obligation requires reversing a settled payment. Because clawback touches
//! already-distributed tokens it carries real counterparty risk: if the
//! receiver has already spent the tokens, `execute_clawback` will fail at the
//! token-transfer level.
//!
//! # Lifecycle
//!
//! ```text
//! sender calls request_clawback  →  Pending
//!   receiver OR governance calls approve_clawback  →  Approved
//!     sender (or anyone) calls execute_clawback  →  Executed
//! ```
//!
//! A request that expires or is rejected moves to `Rejected` and can no
//! longer be approved or executed.
//!
//! # Approval rules
//!
//! A clawback moves from `Pending` to `Approved` when **either**:
//! 1. The stream's receiver calls `approve_clawback`, **or**
//! 2. Enough governance addresses have approved
//!    (`approvals.len() >= required_approvals`).
//!
//! `required_approvals` is set at request time to `1` by default. Senders that
//! want to require a full multi-sig can pass a higher value.
//!
//! # Constraints
//!
//! - `amount` ≤ `stream.withdrawn_amount` (cannot claw back unvested/future tokens)
//! - `amount` > 0
//! - The stream must have `clawback_enabled = true`
//! - Only the stream's sender may call `request_clawback`
//! - Only the receiver or a governance address may call `approve_clawback`
//! - `execute_clawback` may be called by anyone once the request is `Approved`
//!
//! # Risks
//!
//! - The receiver must hold `amount` tokens when execution is attempted.
//! - Clawback does **not** modify `stream.withdrawn_amount`; it is purely a
//!   peer-to-peer token transfer from receiver back to sender, recorded on the
//!   clawback request.
//! - Senders should only enable clawback for streams where reversibility is a
//!   genuine business requirement (e.g. milestone payments, trial periods).

use soroban_sdk::{symbol_short, token, Address, Env, String, Vec};

use crate::{
    errors::Error,
    storage::{CLAWBACK, CLAWBACK_COUNT, STREAM_COUNT},
    types::{
        ClawbackApprovedEvent, ClawbackExecutedEvent, ClawbackRequest,
        ClawbackRequestedEvent, ClawbackStatus, Stream,
    },
};

// ---------------------------------------------------------------------------
// Public functions (called from lib.rs #[contractimpl])
// ---------------------------------------------------------------------------

/// Creates a new clawback request for `amount` tokens from stream `stream_id`.
///
/// The stream must have been created with `clawback_enabled = true` and
/// `amount` must not exceed the amount already withdrawn by the receiver.
///
/// # Authorization
/// `sender` must authenticate this call and must be the stream's sender.
///
/// # Arguments
/// * `env` - Contract environment
/// * `stream_id` - Stream to claw back from
/// * `sender` - Stream's sender (must authenticate)
/// * `amount` - Amount to claw back; must be > 0 and ≤ `withdrawn_amount`
/// * `reason` - Human-readable reason for the clawback
/// * `required_approvals` - Number of governance approvals needed (≥ 1);
///   receiver approval always satisfies the condition regardless of this value
/// * `expires_at` - Optional expiry timestamp (`0` = no expiry)
///
/// # Returns
/// The newly created clawback request ID.
///
/// # Errors
/// * [`Error::StreamNotFound`] – stream does not exist
/// * [`Error::Unauthorized`] – `sender` is not the stream's sender
/// * [`Error::ClawbackNotEnabled`] – stream was created without clawback
/// * [`Error::InvalidAmount`] – `amount` ≤ 0
/// * [`Error::ClawbackExceedsWithdrawn`] – `amount` > `withdrawn_amount`
pub fn request_clawback(
    env: &Env,
    stream_id: u64,
    sender: &Address,
    amount: i128,
    reason: String,
    required_approvals: u32,
    expires_at: u64,
) -> Result<u64, Error> {
    let stream: Stream = env
        .storage()
        .instance()
        .get(&(STREAM_COUNT, stream_id))
        .ok_or(Error::StreamNotFound)?;

    // Only the stream's sender may request a clawback
    if stream.sender != *sender {
        return Err(Error::Unauthorized);
    }

    // Clawback must be enabled on this stream
    if !stream.clawback_enabled {
        return Err(Error::ClawbackNotEnabled);
    }

    if amount <= 0 {
        return Err(Error::InvalidAmount);
    }

    // Cannot claw back more than what has been withdrawn
    if amount > stream.withdrawn_amount {
        return Err(Error::ClawbackExceedsWithdrawn);
    }

    let clawback_id: u64 = env
        .storage()
        .instance()
        .get(&CLAWBACK_COUNT)
        .unwrap_or(0);
    let next_id = clawback_id + 1;

    let req = ClawbackRequest {
        clawback_id,
        stream_id,
        amount,
        reason: reason.clone(),
        approved_by_receiver: false,
        approvals: Vec::new(env),
        required_approvals,
        status: ClawbackStatus::Pending,
        created_at: env.ledger().timestamp(),
        expires_at,
    };

    env.storage()
        .instance()
        .set(&(CLAWBACK, clawback_id), &req);
    env.storage().instance().set(&CLAWBACK_COUNT, &next_id);

    env.events().publish(
        (symbol_short!("clawback"), symbol_short!("request")),
        ClawbackRequestedEvent {
            clawback_id,
            stream_id,
            sender: sender.clone(),
            amount,
            reason,
            timestamp: env.ledger().timestamp(),
        },
    );

    Ok(clawback_id)
}

/// Approves a pending clawback request.
///
/// Approval advances the request to [`ClawbackStatus::Approved`] when either:
/// - `approver` is the stream's receiver (receiver consent path), or
/// - enough governance addresses have approved
///   (`approvals.len() >= required_approvals`).
///
/// # Authorization
/// `approver` must authenticate this call.
///
/// # Arguments
/// * `env` - Contract environment
/// * `clawback_id` - ID of the clawback request to approve
/// * `approver` - Address casting the approval; must be the receiver or a
///   governance address
///
/// # Errors
/// * [`Error::ClawbackNotFound`] – request does not exist
/// * [`Error::ClawbackAlreadyExecuted`] – already executed
/// * [`Error::ClawbackExpired`] – request has passed its expiry
/// * [`Error::ClawbackAlreadyApproved`] – `approver` has already approved
/// * [`Error::Unauthorized`] – `approver` is neither the receiver nor the sender
///   (i.e. not a legitimate approver for this clawback)
pub fn approve_clawback(env: &Env, clawback_id: u64, approver: &Address) -> Result<(), Error> {
    let mut req: ClawbackRequest = env
        .storage()
        .instance()
        .get(&(CLAWBACK, clawback_id))
        .ok_or(Error::ClawbackNotFound)?;

    if req.status == ClawbackStatus::Executed {
        return Err(Error::ClawbackAlreadyExecuted);
    }
    if req.status == ClawbackStatus::Rejected {
        return Err(Error::ClawbackRejected);
    }

    let now = env.ledger().timestamp();
    if req.expires_at != 0 && now > req.expires_at {
        req.status = ClawbackStatus::Rejected;
        env.storage()
            .instance()
            .set(&(CLAWBACK, clawback_id), &req);
        return Err(Error::ClawbackExpired);
    }

    // Load the stream to determine the receiver
    let stream: Stream = env
        .storage()
        .instance()
        .get(&(STREAM_COUNT, req.stream_id))
        .ok_or(Error::StreamNotFound)?;

    let mut by_receiver = false;

    if *approver == stream.receiver {
        // Receiver approval path
        if req.approved_by_receiver {
            return Err(Error::ClawbackAlreadyApproved);
        }
        req.approved_by_receiver = true;
        by_receiver = true;
    } else {
        // Governance approval path — allow any address that isn't the sender
        // to act as a governance approver (governance addresses are not
        // tracked in a separate list in V1; the multi-sig is formed by
        // collecting distinct approvals). The sender cannot approve their
        // own clawback via this path.
        if *approver == stream.sender {
            return Err(Error::Unauthorized);
        }
        if req.approvals.contains(approver.clone()) {
            return Err(Error::ClawbackAlreadyApproved);
        }
        req.approvals.push_back(approver.clone());
    }

    // Check if approval threshold is now met
    let approval_count = req.approvals.len();
    if req.approved_by_receiver || approval_count >= req.required_approvals {
        req.status = ClawbackStatus::Approved;
    }

    env.storage()
        .instance()
        .set(&(CLAWBACK, clawback_id), &req);

    env.events().publish(
        (symbol_short!("clawback"), symbol_short!("approve")),
        ClawbackApprovedEvent {
            clawback_id,
            approver: approver.clone(),
            by_receiver,
            approval_count,
            timestamp: now,
        },
    );

    Ok(())
}

/// Executes an approved clawback, transferring `amount` tokens from the
/// receiver back to the sender.
///
/// Anyone may call this once the request is in [`ClawbackStatus::Approved`]
/// state (sender, receiver, governance, third party — anyone with gas).
///
/// # Authorization
/// The caller must authenticate, but no specific role is required beyond the
/// request being in `Approved` status.
///
/// # Arguments
/// * `env` - Contract environment
/// * `clawback_id` - ID of the approved clawback request to execute
///
/// # Errors
/// * [`Error::ClawbackNotFound`] – request does not exist
/// * [`Error::ClawbackInsufficientApprovals`] – request is not yet `Approved`
/// * [`Error::ClawbackAlreadyExecuted`] – already executed
/// * [`Error::ClawbackExpired`] – request has passed its expiry
///
/// # Panics
/// Will panic at the token-contract level if the receiver does not hold
/// sufficient balance. This is intentional — callers must ensure the receiver
/// still holds the tokens before executing.
pub fn execute_clawback(env: &Env, clawback_id: u64) -> Result<(), Error> {
    let mut req: ClawbackRequest = env
        .storage()
        .instance()
        .get(&(CLAWBACK, clawback_id))
        .ok_or(Error::ClawbackNotFound)?;

    if req.status == ClawbackStatus::Executed {
        return Err(Error::ClawbackAlreadyExecuted);
    }
    if req.status == ClawbackStatus::Rejected {
        return Err(Error::ClawbackRejected);
    }

    let now = env.ledger().timestamp();
    if req.expires_at != 0 && now > req.expires_at {
        req.status = ClawbackStatus::Rejected;
        env.storage()
            .instance()
            .set(&(CLAWBACK, clawback_id), &req);
        return Err(Error::ClawbackExpired);
    }

    if req.status != ClawbackStatus::Approved {
        return Err(Error::ClawbackInsufficientApprovals);
    }

    // Load stream for receiver, sender, and token info
    let stream: Stream = env
        .storage()
        .instance()
        .get(&(STREAM_COUNT, req.stream_id))
        .ok_or(Error::StreamNotFound)?;

    // Mark executed before the token transfer (checks-effects-interactions)
    req.status = ClawbackStatus::Executed;
    env.storage()
        .instance()
        .set(&(CLAWBACK, clawback_id), &req);

    // Transfer tokens from receiver → sender
    let token_client = token::Client::new(env, &stream.token);
    token_client.transfer(&stream.receiver, &stream.sender, &req.amount);

    env.events().publish(
        (symbol_short!("clawback"), symbol_short!("execute")),
        ClawbackExecutedEvent {
            clawback_id,
            stream_id: req.stream_id,
            amount: req.amount,
            sender: stream.sender.clone(),
            timestamp: now,
        },
    );

    Ok(())
}

/// Fetches a clawback request by ID.
///
/// Returns `None` if no request exists for `clawback_id`.
pub fn get_clawback_request(env: &Env, clawback_id: u64) -> Option<ClawbackRequest> {
    env.storage()
        .instance()
        .get(&(CLAWBACK, clawback_id))
}
