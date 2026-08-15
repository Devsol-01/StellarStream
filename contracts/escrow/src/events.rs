use soroban_sdk::{symbol_short, Address, Env};

pub fn emit_escrow_created(env: &Env, escrow_id: u64, depositor: &Address, recipient: &Address, amount: i128) {
    env.events().publish(
        (symbol_short!("escrow"), symbol_short!("created"), depositor.clone()),
        (escrow_id, recipient.clone(), amount),
    );
}

pub fn emit_escrow_funded(env: &Env, escrow_id: u64, depositor: &Address, amount: i128) {
    env.events().publish(
        (symbol_short!("escrow"), symbol_short!("funded"), depositor.clone()),
        (escrow_id, amount, env.ledger().timestamp()),
    );
}

pub fn emit_escrow_released(env: &Env, escrow_id: u64, recipient: &Address, amount: i128) {
    env.events().publish(
        (symbol_short!("escrow"), symbol_short!("released"), recipient.clone()),
        (escrow_id, amount, env.ledger().timestamp()),
    );
}

pub fn emit_escrow_refunded(env: &Env, escrow_id: u64, depositor: &Address, amount: i128) {
    env.events().publish(
        (symbol_short!("escrow"), symbol_short!("refunded"), depositor.clone()),
        (escrow_id, amount, env.ledger().timestamp()),
    );
}

pub fn emit_dispute_raised(env: &Env, escrow_id: u64, raised_by: &Address) {
    env.events().publish(
        (symbol_short!("escrow"), symbol_short!("dispute"), raised_by.clone()),
        (escrow_id, env.ledger().timestamp()),
    );
}

pub fn emit_dispute_resolved(env: &Env, escrow_id: u64, resolution: &u32) {
    env.events().publish(
        (symbol_short!("escrow"), symbol_short!("resolved")),
        (escrow_id, resolution, env.ledger().timestamp()),
    );
}
