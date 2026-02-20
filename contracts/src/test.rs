#![cfg(test)]

use super::*;
// Note: testutils trait is needed for Address::generate
use soroban_sdk::testutils::{Address as _, Ledger as _};
use soroban_sdk::{token, Address, Env};

struct TestContext {
    env: Env,
    contract_id: Address,
    client: StellarStreamClient<'static>,
    token_admin: Address,
    token: token::StellarAssetClient<'static>,
    token_id: Address,
}

fn setup_test() -> TestContext {
    let env = Env::default();
    env.mock_all_auths();

    // v22 Change: register_contract -> register
    let contract_id = env.register(StellarStream, ());
    let client = StellarStreamClient::new(&env, &contract_id);

    let token_admin = Address::generate(&env);

    // v22 Change: register_stellar_asset_contract -> register_stellar_asset_contract
    let token_id = env.register_stellar_asset_contract(token_admin.clone());
    let token = token::StellarAssetClient::new(&env, &token_id);

    TestContext {
        env,
        contract_id,
        client,
        token_admin,
        token,
        token_id,
    }
}

#[test]
fn test_full_stream_cycle() {
    let ctx = setup_test();
    let sender = Address::generate(&ctx.env);
    let receiver = Address::generate(&ctx.env);

    let amount = 100_i128;
    let start_time = 1000;
    let end_time = 1100;

    ctx.token.mint(&sender, &amount);

    let stream_id = ctx.client.create_stream(
        &sender,
        &receiver,
        &ctx.token_id,
        &amount,
        &start_time,
        &end_time,
    );

    // v22 Change: ledger().with_mut() -> ledger().set()
    ctx.env.ledger().set(soroban_sdk::testutils::LedgerInfo {
        timestamp: 1050,
        protocol_version: 22,
        sequence_number: 1,
        network_id: [0u8; 32],
        base_reserve: 0,
        min_temp_entry_ttl: 0,
        min_persistent_entry_ttl: 0,
        max_entry_ttl: 1000000,
    });

    let withdrawn = ctx.client.withdraw(&stream_id, &receiver);
    assert_eq!(withdrawn, 50);

    let token_client = token::Client::new(&ctx.env, &ctx.token_id);
    assert_eq!(token_client.balance(&receiver), 50);
}

#[test]
#[should_panic(expected = "Unauthorized: You are not the receiver of this stream")]
fn test_unauthorized_withdrawal() {
    let ctx = setup_test();
    let sender = Address::generate(&ctx.env);
    let receiver = Address::generate(&ctx.env);
    let thief = Address::generate(&ctx.env);

    ctx.token.mint(&sender, &100);
    let stream_id = ctx
        .client
        .create_stream(&sender, &receiver, &ctx.token_id, &100, &0, &100);

    ctx.client.withdraw(&stream_id, &thief);
}

#[test]
fn test_cancellation_split() {
    let ctx = setup_test();
    let sender = Address::generate(&ctx.env);
    let receiver = Address::generate(&ctx.env);
    let amount = 1000_i128;

    ctx.token.mint(&sender, &amount);
    let stream_id = ctx
        .client
        .create_stream(&sender, &receiver, &ctx.token_id, &amount, &0, &1000);

    // Jump to 25% (250 seconds in)
    ctx.env.ledger().set(soroban_sdk::testutils::LedgerInfo {
        timestamp: 250,
        protocol_version: 22,
        sequence_number: 1,
        network_id: [0u8; 32],
        base_reserve: 0,
        min_temp_entry_ttl: 0,
        min_persistent_entry_ttl: 0,
        max_entry_ttl: 1000000,
    });

    ctx.client.cancel_stream(&stream_id);

    let token_client = token::Client::new(&ctx.env, &ctx.token_id);
    assert_eq!(token_client.balance(&receiver), 250);
    assert_eq!(token_client.balance(&sender), 750);
}
