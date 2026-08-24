//! OFAC compliance module for the StellarStream contract.
//!
//! This module implements an on-chain denylist that prevents sanctioned
//! addresses from interacting with the protocol. Compliance officers (holders
//! of the [`Role::SuperAdmin`] role) can add or remove addresses from a
//! persistent restricted-address list.
//!
//! # Enforcement points
//!
//! Restriction checks are evaluated at:
//! - **Stream creation** – both the sender and the receiver are checked before
//!   any funds are transferred or storage is written. A restricted sender
//!   cannot fund new streams; a restricted receiver cannot be streamed to.
//! - **Withdraw** – the receiver is checked before any tokens are released.
//!   Withdrawals from existing streams are blocked for restricted receivers,
//!   though cancellation (which returns funds to the sender) remains available.
//! - **Proposal creation** – the receiver is checked before a governance
//!   proposal is recorded.
//! - **Receipt transfer** – the new owner is checked before the receipt is
//!   moved to a potentially sanctioned address.
//!
//! # Cancellation carve-out
//!
//! A restricted sender can still cancel an existing stream they created.
//! This is intentional: the cancel path returns unvested funds to the sender
//! and vested funds to the receiver — both of which are restorative, not
//! protocol-expanding, actions. Blocking cancellation would trap funds in
//! the contract with no recovery path.
//!
//! # Storage
//!
//! The restricted-address list is stored in **persistent** storage under
//! [`crate::storage::RESTRICTED_ADDRESSES`]. Persistent storage survives
//! contract upgrades and is not subject to instance-TTL expiry, making it
//! the correct choice for a compliance list that must outlive any individual
//! stream or session.
//!
//! # Events
//!
//! Every successful restriction change emits an event:
//! - `("compliance", "restrict")` with the target address
//! - `("compliance", "unrestrict")` with the target address
//!
//! # Error codes
//!
//! | Error | Meaning |
//! |-------|---------|
//! | [`Error::Unauthorized`] | Caller does not hold [`Role::SuperAdmin`] |
//! | [`Error::AddressRestricted`] | Operation blocked because address is restricted |

use soroban_sdk::{symbol_short, Address, Env, Vec};

use crate::{
    errors::Error,
    storage::RESTRICTED_ADDRESSES,
    types::{DataKey, Role},
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/// Load the full restricted-address list from persistent storage.
///
/// Callers that need to test multiple addresses in one operation should call
/// this once and reuse the returned `Vec` instead of hitting storage per
/// address.
pub(crate) fn load_restricted(env: &Env) -> Vec<Address> {
    env.storage()
        .persistent()
        .get(&RESTRICTED_ADDRESSES)
        .unwrap_or_else(|| Vec::new(env))
}

/// Persist the restricted-address list back to storage.
fn save_restricted(env: &Env, list: &Vec<Address>) {
    env.storage().persistent().set(&RESTRICTED_ADDRESSES, list);
}

/// Require that `caller` holds [`Role::SuperAdmin`], panicking with
/// [`Error::Unauthorized`] if they do not.
fn require_super_admin(env: &Env, caller: &Address) {
    let is_admin: bool = env
        .storage()
        .instance()
        .get(&DataKey::Role(caller.clone(), Role::SuperAdmin))
        .unwrap_or(false);
    if !is_admin {
        soroban_sdk::panic_with_error!(env, Error::Unauthorized);
    }
}

// ---------------------------------------------------------------------------
// Public functions (called from lib.rs #[contractimpl])
// ---------------------------------------------------------------------------

/// Adds `target` to the persistent restricted-address list.
///
/// If `target` is already on the list this function is a no-op (idempotent).
///
/// # Authorization
/// `admin` must hold [`Role::SuperAdmin`] and must authenticate the call
/// before this function is invoked (via `admin.require_auth()` in the
/// calling entry point).
///
/// # Events
/// Emits `("compliance", "restrict")` → `target` on success.
///
/// # Errors
/// * [`Error::Unauthorized`] — `admin` does not hold [`Role::SuperAdmin`].
pub fn restrict_address(env: &Env, admin: &Address, target: &Address) -> Result<(), Error> {
    require_super_admin(env, admin);

    let mut list = load_restricted(env);
    if !list.contains(target.clone()) {
        list.push_back(target.clone());
        save_restricted(env, &list);
    }

    env.events().publish(
        (symbol_short!("complnc"), symbol_short!("restrict")),
        target.clone(),
    );

    Ok(())
}

/// Removes `target` from the persistent restricted-address list.
///
/// If `target` is not on the list this function is a no-op (idempotent).
///
/// # Authorization
/// `admin` must hold [`Role::SuperAdmin`] and must authenticate the call
/// before this function is invoked (via `admin.require_auth()` in the
/// calling entry point).
///
/// # Events
/// Emits `("compliance", "unrestrict")` → `target` on success.
///
/// # Errors
/// * [`Error::Unauthorized`] — `admin` does not hold [`Role::SuperAdmin`].
pub fn unrestrict_address(env: &Env, admin: &Address, target: &Address) -> Result<(), Error> {
    require_super_admin(env, admin);

    let list = load_restricted(env);
    let mut new_list = Vec::new(env);
    for a in list.iter() {
        if a != *target {
            new_list.push_back(a);
        }
    }
    save_restricted(env, &new_list);

    env.events().publish(
        (symbol_short!("complnc"), symbol_short!("unrestct")),
        target.clone(),
    );

    Ok(())
}

/// Returns `true` if `address` is currently on the restricted list.
///
/// This is a pure read; it never panics and never emits an event.
pub fn is_restricted(env: &Env, address: &Address) -> bool {
    load_restricted(env).contains(address.clone())
}

/// Panics with [`Error::AddressRestricted`] if `address` is on the
/// restricted list. Use this as a single-address guard at entry points.
pub fn require_not_restricted(env: &Env, address: &Address) {
    if is_restricted(env, address) {
        soroban_sdk::panic_with_error!(env, Error::AddressRestricted);
    }
}
