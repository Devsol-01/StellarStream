#![cfg(test)]

use super::*;
use soroban_sdk::testutils::{Address as _, Ledger as _};
use soroban_sdk::{token, Address, Env, CurveType};

#[allow(dead_code)]
struct TestContext {
    env: Env,
    client: StellarStreamClient<'static>,
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

    // v22 Change: Use v2 method to avoid deprecation warning
    let token_id = env.register_stellar_asset_contract_v2(token_admin.clone());
    let token = token::StellarAssetClient::new(&env, &token_id.address());

    TestContext {
        env,
        client,
        token,
        token_id: token_id.address(),
    }
}

#[test]
fn test_full_stream_cycle() {
    let ctx = setup_test();
    let sender = Address::generate(&ctx.env);
    let receiver = Address::generate(&ctx.env);

    let amount = 100_i128;
    let start_time = 1000;
    let cliff_time = 1025;
    let end_time = 1100;

    ctx.token.mint(&sender, &amount);

    let stream_id = ctx.client.create_stream(
        &sender,
        &receiver,
        &ctx.token_id,
        &amount,
        &start_time,
        &cliff_time,
        &end_time,
        &CurveType::Linear,
        &false,
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
    let stream_id = ctx.client.create_stream(
        &sender,
        &receiver,
        &ctx.token_id,
        &100,
        &0,
        &50,
        &100,
        &CurveType::Linear,
        &false,
    );

    ctx.client.withdraw(&stream_id, &thief);
}

#[test]
fn test_cancellation_split() {
    let ctx = setup_test();
    let sender = Address::generate(&ctx.env);
    let receiver = Address::generate(&ctx.env);
    let amount = 1000_i128;

    ctx.token.mint(&sender, &amount);
    let stream_id = ctx.client.create_stream(
        &sender,
        &receiver,
        &ctx.token_id,
        &amount,
        &0,
        &100,
        &1000,
        &CurveType::Linear,
        &false,
    );

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

#[test]
fn test_protocol_fee() {
    let ctx = setup_test();
    let admin = Address::generate(&ctx.env);
    let treasury = Address::generate(&ctx.env);
    let sender = Address::generate(&ctx.env);
    let receiver = Address::generate(&ctx.env);

    // Initialize contract with admin (grants all roles)
    ctx.client.initialize(&admin);
    ctx.client.initialize_fee(&admin, &100, &treasury);

    ctx.token.mint(&sender, &1000);
    let stream_id = ctx.client.create_stream(
        &sender,
        &receiver,
        &ctx.token_id,
        &1000,
        &0,
        &100,
        &1000,
        &CurveType::Linear,
        &false,
    );

    assert_eq!(stream_id, 1);

    let token_client = token::Client::new(&ctx.env, &ctx.token_id);
    assert_eq!(token_client.balance(&treasury), 10);
    assert_eq!(token_client.balance(&ctx.contract_id), 990);
}

#[test]
fn test_transfer_receiver() {
    let ctx = setup_test();
    let sender = Address::generate(&ctx.env);
    let old_receiver = Address::generate(&ctx.env);
    let new_receiver = Address::generate(&ctx.env);

    ctx.token.mint(&sender, &1000);
    let stream_id = ctx.client.create_stream(
        &sender,
        &old_receiver,
        &ctx.token_id,
        &1000,
        &0,
        &100,
        &1000,
        &CurveType::Linear,
        &false,
    );

    ctx.client.transfer_receiver(&stream_id, &new_receiver);

    ctx.env.ledger().set(soroban_sdk::testutils::LedgerInfo {
        timestamp: 500,
        protocol_version: 22,
        sequence_number: 1,
        network_id: [0u8; 32],
        base_reserve: 0,
        min_temp_entry_ttl: 0,
        min_persistent_entry_ttl: 0,
        max_entry_ttl: 1000000,
    });

    let withdrawn = ctx.client.withdraw(&stream_id, &new_receiver);
    assert_eq!(withdrawn, 500);

    let token_client = token::Client::new(&ctx.env, &ctx.token_id);
    assert_eq!(token_client.balance(&new_receiver), 500);
}

#[test]
#[should_panic(expected = "Unauthorized: You are not the receiver of this stream")]
fn test_old_receiver_cannot_withdraw_after_transfer() {
    let ctx = setup_test();
    let sender = Address::generate(&ctx.env);
    let old_receiver = Address::generate(&ctx.env);
    let new_receiver = Address::generate(&ctx.env);

    ctx.token.mint(&sender, &1000);
    let stream_id = ctx.client.create_stream(
        &sender,
        &old_receiver,
        &ctx.token_id,
        &1000,
        &0,
        &100,
        &1000,
        &CurveType::Linear,
        &false,
    );

    ctx.client.transfer_receiver(&stream_id, &new_receiver);

    ctx.env.ledger().set(soroban_sdk::testutils::LedgerInfo {
        timestamp: 500,
        protocol_version: 22,
        sequence_number: 1,
        network_id: [0u8; 32],
        base_reserve: 0,
        min_temp_entry_ttl: 0,
        min_persistent_entry_ttl: 0,
        max_entry_ttl: 1000000,
    });

    ctx.client.withdraw(&stream_id, &old_receiver);
}

#[test]
fn test_batch_stream_creation() {
    let ctx = setup_test();
    let sender = Address::generate(&ctx.env);
    let receiver1 = Address::generate(&ctx.env);
    let receiver2 = Address::generate(&ctx.env);
    let receiver3 = Address::generate(&ctx.env);

    let total_amount = 3000_i128;
    ctx.token.mint(&sender, &total_amount);

    let mut requests = soroban_sdk::Vec::new(&ctx.env);
    requests.push_back(StreamRequest {
        receiver: receiver1.clone(),
        amount: 1000,
        start_time: 0,
        cliff_time: 100,
        end_time: 1000,
        interest_strategy: 2,
        vault_address: None,
        metadata: None,
    });
    requests.push_back(StreamRequest {
        receiver: receiver2.clone(),
        amount: 1500,
        start_time: 0,
        cliff_time: 100,
        end_time: 1000,
        interest_strategy: 2,
        vault_address: None,
        metadata: None,
    });
    requests.push_back(StreamRequest {
        receiver: receiver3.clone(),
        amount: 500,
        start_time: 0,
        cliff_time: 100,
        end_time: 1000,
        interest_strategy: 2,
        vault_address: None,
        metadata: None,
    });

    let stream_ids = ctx
        .client
        .create_batch_streams(&sender, &ctx.token_id, &requests);

    assert_eq!(stream_ids.len(), 3);
    assert_eq!(stream_ids.get(0).unwrap(), 1);
    assert_eq!(stream_ids.get(1).unwrap(), 2);
    assert_eq!(stream_ids.get(2).unwrap(), 3);

    let token_client = token::Client::new(&ctx.env, &ctx.token_id);
    assert_eq!(token_client.balance(&ctx.contract_id), 3000);
}

#[test]
#[should_panic(expected = "Contract is paused")]
fn test_pause_blocks_create_stream() {
    let ctx = setup_test();
    let admin = Address::generate(&ctx.env);
    let sender = Address::generate(&ctx.env);
    let receiver = Address::generate(&ctx.env);

    ctx.client.initialize(&admin);
    ctx.client.set_pause(&admin, &true);

    ctx.token.mint(&sender, &1000);
    ctx.client.create_stream(
        &sender,
        &receiver,
        &ctx.token_id,
        &1000,
        &0,
        &100,
        &1000,
        &CurveType::Linear,
        &false,
    );
}

#[test]
#[should_panic(expected = "Contract is paused")]
fn test_pause_blocks_withdraw() {
    let ctx = setup_test();
    let admin = Address::generate(&ctx.env);
    let sender = Address::generate(&ctx.env);
    let receiver = Address::generate(&ctx.env);

    ctx.client.initialize(&admin);
    ctx.token.mint(&sender, &1000);
    let stream_id = ctx.client.create_stream(
        &sender,
        &receiver,
        &ctx.token_id,
        &1000,
        &0,
        &100,
        &1000,
        &CurveType::Linear,
        &false,
    );

    ctx.client.set_pause(&admin, &true);

    ctx.env.ledger().set(soroban_sdk::testutils::LedgerInfo {
        timestamp: 500,
        protocol_version: 22,
        sequence_number: 1,
        network_id: [0u8; 32],
        base_reserve: 0,
        min_temp_entry_ttl: 0,
        min_persistent_entry_ttl: 0,
        max_entry_ttl: 1000000,
    });

    ctx.client.withdraw(&stream_id, &receiver);
}

#[test]
#[should_panic(expected = "Fee cannot exceed 10%")]
fn test_fee_cap() {
    let ctx = setup_test();
    let admin = Address::generate(&ctx.env);
    let treasury = Address::generate(&ctx.env);

    // Initialize contract with admin (grants all roles)
    ctx.client.initialize(&admin);
    ctx.client.initialize_fee(&admin, &1001, &treasury);
}

#[test]
fn test_update_fee() {
    let ctx = setup_test();
    let admin = Address::generate(&ctx.env);
    let treasury = Address::generate(&ctx.env);

    // Initialize contract with admin (grants all roles)
    ctx.client.initialize(&admin);
    ctx.client.initialize_fee(&admin, &100, &treasury);
    ctx.client.update_fee(&admin, &200);
}

#[test]
#[should_panic(expected = "No funds available to withdraw at this time")]
fn test_cliff_blocks_withdrawal() {
    let ctx = setup_test();
    let sender = Address::generate(&ctx.env);
    let receiver = Address::generate(&ctx.env);

    ctx.token.mint(&sender, &1000);
    let stream_id = ctx.client.create_stream(
        &sender,
        &receiver,
        &ctx.token_id,
        &1000,
        &0,
        &500,
        &1000,
        &CurveType::Linear,
        &false,
    );

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

    ctx.client.withdraw(&stream_id, &receiver);
}

#[test]
fn test_cliff_unlocks_at_cliff_time() {
    let ctx = setup_test();
    let sender = Address::generate(&ctx.env);
    let receiver = Address::generate(&ctx.env);

    ctx.token.mint(&sender, &1000);
    let stream_id = ctx.client.create_stream(
        &sender,
        &receiver,
        &ctx.token_id,
        &1000,
        &0,
        &500,
        &1000,
        &CurveType::Linear,
        &false,
    );

    ctx.env.ledger().set(soroban_sdk::testutils::LedgerInfo {
        timestamp: 500,
        protocol_version: 22,
        sequence_number: 1,
        network_id: [0u8; 32],
        base_reserve: 0,
        min_temp_entry_ttl: 0,
        min_persistent_entry_ttl: 0,
        max_entry_ttl: 1000000,
    });

    ctx.client.withdraw(&stream_id, &receiver);
}

#[test]
fn test_unpause_allows_operations() {
    let ctx = setup_test();
    let admin = Address::generate(&ctx.env);
    let sender = Address::generate(&ctx.env);
    let receiver = Address::generate(&ctx.env);

    ctx.client.initialize(&admin);
    ctx.client.set_pause(&admin, &true);
    ctx.client.set_pause(&admin, &false);

    ctx.token.mint(&sender, &1000);
    let stream_id = ctx.client.create_stream(
        &sender,
        &receiver,
        &ctx.token_id,
        &1000,
        &0,
        &100,
        &1000,
        &CurveType::Linear,
        &false,
    );

    ctx.env.ledger().set(soroban_sdk::testutils::LedgerInfo {
        timestamp: 500,
        protocol_version: 22,
        sequence_number: 1,
        network_id: [0u8; 32],
        base_reserve: 0,
        min_temp_entry_ttl: 0,
        min_persistent_entry_ttl: 0,
        max_entry_ttl: 1000000,
    });

    assert_eq!(stream_id, 1);
    let withdrawn = ctx.client.withdraw(&stream_id, &receiver);
    assert_eq!(withdrawn, 500);
}

#[test]
#[should_panic(expected = "Cliff time must be between start and end time")]
fn test_invalid_cliff_time() {
    let ctx = setup_test();
    let sender = Address::generate(&ctx.env);
    let receiver = Address::generate(&ctx.env);

    ctx.token.mint(&sender, &1000);
    ctx.client.create_stream(
        &sender,
        &receiver,
        &ctx.token_id,
        &1000,
        &100,
        &50,
        &200,
        &CurveType::Linear,
        &false,
    );
}

#[test]
fn test_empty_tvl() {
    let ctx = setup_test();
    assert_eq!(ctx.client.get_token_tvl(&ctx.token_id), 0);
}

#[test]
fn test_single_token_tvl() {
    let ctx = setup_test();
    let sender = Address::generate(&ctx.env);
    let receiver = Address::generate(&ctx.env);

    ctx.token.mint(&sender, &1000);
    let stream_id = ctx.client.create_stream(
        &sender,
        &receiver,
        &ctx.token_id,
        &1000,
        &0,
        &100,
        &1000,
        &CurveType::Linear,
        &false,
    );

    assert_eq!(ctx.client.get_token_tvl(&ctx.token_id), 1000);
}

#[test]
fn test_multiple_tokens_tvl() {
    let ctx = setup_test();
    let sender = Address::generate(&ctx.env);
    let receiver = Address::generate(&ctx.env);
    let token2 = Address::generate(&ctx.env);
    let token2_client = token::StellarAssetClient::new(&ctx.env, &token2);

    let token2_admin = Address::generate(&ctx.env);
    let token2_id = ctx.env.register_stellar_asset_contract_v2(token2_admin);
    let token2_id_addr = token2_id.address();

    ctx.token.mint(&sender, &1000);
    token2_client.mint(&sender, &500);

    let stream_id1 = ctx.client.create_stream(
        &sender,
        &receiver,
        &ctx.token_id,
        &1000,
        &0,
        &100,
        &1000,
        &CurveType::Linear,
        &false,
    );

    let stream_id2 = ctx.client.create_stream(
        &sender,
        &receiver,
        &token2_id_addr,
        &500,
        &0,
        &100,
        &1000,
        &CurveType::Linear,
        &false,
    );

    assert_eq!(ctx.client.get_token_tvl(&ctx.token_id), 1000);
    assert_eq!(ctx.client.get_token_tvl(&token2_id_addr), 500);

    let all_tvl = ctx.client.get_all_tokens_tvl();
    assert_eq!(all_tvl.get(ctx.token_id.clone()), Some(1000));
    assert_eq!(all_tvl.get(token2_id_addr.clone()), Some(500));
}

#[test]
fn test_tvl_updates_on_create() {
    let ctx = setup_test();
    let sender = Address::generate(&ctx.env);
    let receiver = Address::generate(&ctx.env);

    assert_eq!(ctx.client.get_token_tvl(&ctx.token_id), 0);

    ctx.token.mint(&sender, &1000);
    ctx.client.create_stream(
        &sender,
        &receiver,
        &ctx.token_id,
        &1000,
        &0,
        &100,
        &1000,
        &CurveType::Linear,
        &false,
    );

    assert_eq!(ctx.client.get_token_tvl(&ctx.token_id), 1000);
}

#[test]
fn test_tvl_updates_on_cancel() {
    let ctx = setup_test();
    let sender = Address::generate(&ctx.env);
    let receiver = Address::generate(&ctx.env);

    ctx.token.mint(&sender, &1000);
    let stream_id = ctx.client.create_stream(
        &sender,
        &receiver,
        &ctx.token_id,
        &1000,
        &0,
        &100,
        &1000,
        &CurveType::Linear,
        &false,
    );

    assert_eq!(ctx.client.get_token_tvl(&ctx.token_id), 1000);

    ctx.client.cancel_stream(&stream_id);

    assert_eq!(ctx.client.get_token_tvl(&ctx.token_id), 0);
}

#[test]
fn test_tvl_updates_on_completion() {
    let ctx = setup_test();
    let sender = Address::generate(&ctx.env);
    let receiver = Address::generate(&ctx.env);

    ctx.token.mint(&sender, &1000);
    let stream_id = ctx.client.create_stream(
        &sender,
        &receiver,
        &ctx.token_id,
        &1000,
        &0,
        &100,
        &1000,
        &CurveType::Linear,
        &false,
    );

    assert_eq!(ctx.client.get_token_tvl(&ctx.token_id), 1000);

    ctx.env.ledger().set(soroban_sdk::testutils::LedgerInfo {
        timestamp: 1000,
        protocol_version: 22,
        sequence_number: 1,
        network_id: [0u8; 32],
        base_reserve: 0,
        min_temp_entry_ttl: 0,
        min_persistent_entry_ttl: 0,
        max_entry_ttl: 1000000,
    });

    ctx.client.withdraw(&stream_id, &receiver);

    assert_eq!(ctx.client.get_token_tvl(&ctx.token_id), 0);
}

#[test]
fn test_withdrawal_does_not_affect_other_token_tvl() {
    let ctx = setup_test();
    let sender = Address::generate(&ctx.env);
    let receiver = Address::generate(&ctx.env);
    let token2 = Address::generate(&ctx.env);
    let token2_client = token::StellarAssetClient::new(&ctx.env, &token2);

    let token2_admin = Address::generate(&ctx.env);
    let token2_id = ctx.env.register_stellar_asset_contract_v2(token2_admin);
    let token2_id_addr = token2_id.address();

    ctx.token.mint(&sender, &1000);
    token2_client.mint(&sender, &500);

    let stream_id1 = ctx.client.create_stream(
        &sender,
        &receiver,
        &ctx.token_id,
        &1000,
        &0,
        &100,
        &1000,
        &CurveType::Linear,
        &false,
    );

    let stream_id2 = ctx.client.create_stream(
        &sender,
        &receiver,
        &token2_id_addr,
        &500,
        &0,
        &100,
        &1000,
        &CurveType::Linear,
        &false,
    );

    assert_eq!(ctx.client.get_token_tvl(&ctx.token_id), 1000);
    assert_eq!(ctx.client.get_token_tvl(&token2_id_addr), 500);

    ctx.env.ledger().set(soroban_sdk::testutils::LedgerInfo {
        timestamp: 500,
        protocol_version: 22,
        sequence_number: 1,
        network_id: [0u8; 32],
        base_reserve: 0,
        min_temp_entry_ttl: 0,
        min_persistent_entry_ttl: 0,
        max_entry_ttl: 1000000,
    });

    ctx.client.withdraw(&stream_id1, &receiver);

    assert_eq!(ctx.client.get_token_tvl(&ctx.token_id), 500);
    assert_eq!(ctx.client.get_token_tvl(&token2_id_addr), 500);
}

#[test]
fn test_withdrawal_decreases_tvl() {
    let ctx = setup_test();
    let sender = Address::generate(&ctx.env);
    let receiver = Address::generate(&ctx.env);

    ctx.token.mint(&sender, &1000);
    let stream_id = ctx.client.create_stream(
        &sender,
        &receiver,
        &ctx.token_id,
        &1000,
        &0,
        &100,
        &1000,
        &CurveType::Linear,
        &false,
    );

    assert_eq!(ctx.client.get_token_tvl(&ctx.token_id), 1000);

    ctx.env.ledger().set(soroban_sdk::testutils::LedgerInfo {
        timestamp: 500,
        protocol_version: 22,
        sequence_number: 1,
        network_id: [0u8; 32],
        base_reserve: 0,
        min_temp_entry_ttl: 0,
        min_persistent_entry_ttl: 0,
        max_entry_ttl: 1000000,
    });

    let withdrawn = ctx.client.withdraw(&stream_id, &receiver);
    assert_eq!(withdrawn, 500);
    assert_eq!(ctx.client.get_token_tvl(&ctx.token_id), 500);
}
