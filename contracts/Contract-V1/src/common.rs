//! Shared test harness: mock ledger token + contract fixture.
#![cfg(test)]

use super::*;
use soroban_sdk::{contract, contractimpl, Address};

/// No-op ledger token. Stream accounting is tracked inside the contract; the
/// token is only invoked to satisfy the `withdraw` external-call path.
#[contract]
pub struct MockToken;

#[contractimpl]
impl MockToken {
    pub fn transfer(_env: Env, _from: Address, _to: Address, _amount: i128) {
        // Intentionally a no-op for unit testing.
    }
}

/// A fully initialized contract fixture.
pub struct Fixture {
    pub env: Env,
    pub contract: Address,
    pub admin: Address,
    pub sender: Address,
    pub receiver: Address,
    pub pauser: Address,
    pub token: Address,
}

/// Build a fresh environment, deploy the contract + a mock token, and
/// initialize the contract (admin + pauser role).
pub fn setup() -> Fixture {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let receiver = Address::generate(&env);
    let pauser = Address::generate(&env);
    let token = env.register_contract(None, MockToken);
    let contract = env.register_contract(None, StellarStreamContract);

    let client = StellarStreamContractClient::new(&env, &contract);
    client.initialize(&admin);
    client.grant_role(&admin, &pauser, &ROLE_PAUSER);

    Fixture {
        env,
        contract,
        admin,
        sender,
        receiver,
        pauser,
        token,
    }
}

/// Convenience client constructor.
pub fn client(env: &Env, contract: &Address) -> StellarStreamContractClient {
    StellarStreamContractClient::new(env, contract)
}

/// Create a stream that is already partially vested by advancing the ledger.
pub fn create_active_stream(
    env: &Env,
    contract: &Address,
    sender: &Address,
    receiver: &Address,
    token: &Address,
    total: i128,
    curve: u32,
) -> u64 {
    let now = env.ledger().timestamp();
    client(env, contract).create_stream(
        sender,
        receiver,
        token,
        &total,
        &(now),
        &(now + 1_000),
        &curve,
        &false,
    )
}
