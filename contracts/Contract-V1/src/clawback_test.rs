#![cfg(test)]
//! Comprehensive tests for the clawback feature (Issue 2).

use crate::types::{CurveType, StreamOptions};
use crate::{StellarStreamContract, StellarStreamContractClient};
use soroban_sdk::testutils::{Address as _, Ledger, LedgerInfo};
use soroban_sdk::token::{StellarAssetClient, TokenClient};
use soroban_sdk::{Address, Env, String};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn ledger_at(env: &Env, ts: u64) {
    env.ledger().set(LedgerInfo {
        timestamp: ts,
        protocol_version: 22,
        sequence_number: (ts / 5) as u32,
        network_id: Default::default(),
        base_reserve: 10,
        min_temp_entry_ttl: 10,
        min_persistent_entry_ttl: 10,
        max_entry_ttl: 3_110_400,
    });
}

/// Deploy, initialize, return (env, client, admin).
fn setup() -> (Env, StellarStreamContractClient<'static>, Address) {
    let env = Env::default();
    env.mock_all_auths();
    ledger_at(&env, 100);
    let admin = Address::generate(&env);
    let id = env.register(StellarStreamContract, ());
    let client = StellarStreamContractClient::new(&env, &id);
    client.initialize(&admin);
    (env, client, admin)
}

/// Mint `amount` tokens to `recipient`, return token address.
fn mint_token(env: &Env, admin: &Address, recipient: &Address, amount: i128) -> Address {
    let token = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    StellarAssetClient::new(env, &token).mint(recipient, &amount);
    token
}

/// Create a clawback-enabled stream (start=100, cliff=100, end=200, total=1000).
fn create_clawback_stream(
    env: &Env,
    client: &StellarStreamContractClient,
    sender: &Address,
    receiver: &Address,
    token: &Address,
) -> u64 {
    let opts = StreamOptions {
        curve_type: CurveType::Linear,
        is_soulbound: false,
        vault_address: None,
        clawback_enabled: true,
    };
    client.create_stream_with_milestones(
        sender,
        receiver,
        token,
        &1000_i128,
        &100_u64,
        &100_u64,
        &200_u64,
        &soroban_sdk::Vec::new(env),
        &opts,
    )
}

fn reason(env: &Env) -> String {
    String::from_str(env, "test reason")
}

// ---------------------------------------------------------------------------
// Test 1: request clawback – basic happy path
// ---------------------------------------------------------------------------
#[test]
fn test_request_clawback_basic() {
    let (env, client, admin) = setup();
    let sender = Address::generate(&env);
    let receiver = Address::generate(&env);
    let token = mint_token(&env, &admin, &sender, 1000);

    let stream_id = create_clawback_stream(&env, &client, &sender, &receiver, &token);

    // advance to 50% so receiver can withdraw
    ledger_at(&env, 150);
    client.withdraw(&stream_id, &receiver);

    let clawback_id =
        client.request_clawback(&stream_id, &sender, &500_i128, &reason(&env), &1_u32, &0_u64);

    let req = client.get_clawback_request(&clawback_id).unwrap();
    assert_eq!(req.stream_id, stream_id);
    assert_eq!(req.amount, 500);
    assert_eq!(req.approved_by_receiver, false);
}

// ---------------------------------------------------------------------------
// Test 2: receiver approval approves and sets status = Approved
// ---------------------------------------------------------------------------
#[test]
fn test_receiver_approval_sets_approved_status() {
    let (env, client, admin) = setup();
    let sender = Address::generate(&env);
    let receiver = Address::generate(&env);
    let token = mint_token(&env, &admin, &sender, 1000);

    let stream_id = create_clawback_stream(&env, &client, &sender, &receiver, &token);
    ledger_at(&env, 150);
    client.withdraw(&stream_id, &receiver);

    let clawback_id =
        client.request_clawback(&stream_id, &sender, &500_i128, &reason(&env), &1_u32, &0_u64);

    client.approve_clawback(&clawback_id, &receiver);

    let req = client.get_clawback_request(&clawback_id).unwrap();
    assert!(req.approved_by_receiver);
    assert_eq!(req.status, crate::types::ClawbackStatus::Approved);
}

// ---------------------------------------------------------------------------
// Test 3: governance multi-sig approval path
// ---------------------------------------------------------------------------
#[test]
fn test_governance_approval_path() {
    let (env, client, admin) = setup();
    let sender = Address::generate(&env);
    let receiver = Address::generate(&env);
    let token = mint_token(&env, &admin, &sender, 1000);
    let gov1 = Address::generate(&env);
    let gov2 = Address::generate(&env);

    let stream_id = create_clawback_stream(&env, &client, &sender, &receiver, &token);
    ledger_at(&env, 150);
    client.withdraw(&stream_id, &receiver);

    // requires 2 governance approvals
    let clawback_id =
        client.request_clawback(&stream_id, &sender, &300_i128, &reason(&env), &2_u32, &0_u64);

    client.approve_clawback(&clawback_id, &gov1);
    let req = client.get_clawback_request(&clawback_id).unwrap();
    // only 1 of 2 – still pending
    assert_eq!(req.status, crate::types::ClawbackStatus::Pending);

    client.approve_clawback(&clawback_id, &gov2);
    let req = client.get_clawback_request(&clawback_id).unwrap();
    assert_eq!(req.status, crate::types::ClawbackStatus::Approved);
}

// ---------------------------------------------------------------------------
// Test 4: execute clawback transfers tokens from receiver to sender
// ---------------------------------------------------------------------------
#[test]
fn test_execute_clawback_transfers_tokens() {
    let (env, client, admin) = setup();
    let sender = Address::generate(&env);
    let receiver = Address::generate(&env);
    let token = mint_token(&env, &admin, &sender, 1000);

    let stream_id = create_clawback_stream(&env, &client, &sender, &receiver, &token);
    ledger_at(&env, 200); // 100% vested
    client.withdraw(&stream_id, &receiver);

    let token_client = TokenClient::new(&env, &token);
    assert_eq!(token_client.balance(&receiver), 1000);
    assert_eq!(token_client.balance(&sender), 0);

    let clawback_id =
        client.request_clawback(&stream_id, &sender, &400_i128, &reason(&env), &1_u32, &0_u64);
    client.approve_clawback(&clawback_id, &receiver);
    client.execute_clawback(&clawback_id, &sender);

    assert_eq!(token_client.balance(&receiver), 600);
    assert_eq!(token_client.balance(&sender), 400);
}

// ---------------------------------------------------------------------------
// Test 5: execute without approval fails
// ---------------------------------------------------------------------------
#[test]
#[should_panic(expected = "Error(Contract, #42)")]
fn test_execute_without_approval_fails() {
    let (env, client, admin) = setup();
    let sender = Address::generate(&env);
    let receiver = Address::generate(&env);
    let token = mint_token(&env, &admin, &sender, 1000);

    let stream_id = create_clawback_stream(&env, &client, &sender, &receiver, &token);
    ledger_at(&env, 150);
    client.withdraw(&stream_id, &receiver);

    let clawback_id =
        client.request_clawback(&stream_id, &sender, &200_i128, &reason(&env), &1_u32, &0_u64);

    // Not yet approved — should panic with ClawbackInsufficientApprovals (#42)
    client.execute_clawback(&clawback_id, &sender);
}

// ---------------------------------------------------------------------------
// Test 6: amount > withdrawn_amount is rejected
// ---------------------------------------------------------------------------
#[test]
#[should_panic(expected = "Error(Contract, #40)")]
fn test_amount_exceeds_withdrawn_rejected() {
    let (env, client, admin) = setup();
    let sender = Address::generate(&env);
    let receiver = Address::generate(&env);
    let token = mint_token(&env, &admin, &sender, 1000);

    let stream_id = create_clawback_stream(&env, &client, &sender, &receiver, &token);
    // Nothing withdrawn yet — any positive amount exceeds withdrawn_amount (0)
    client.request_clawback(&stream_id, &sender, &1_i128, &reason(&env), &1_u32, &0_u64);
}

// ---------------------------------------------------------------------------
// Test 7: multiple independent clawback requests on same stream
// ---------------------------------------------------------------------------
#[test]
fn test_multiple_clawbacks_on_same_stream() {
    let (env, client, admin) = setup();
    let sender = Address::generate(&env);
    let receiver = Address::generate(&env);
    let token = mint_token(&env, &admin, &sender, 2000);

    let stream_id = create_clawback_stream(&env, &client, &sender, &receiver, &token);
    // Use a stream with 2000 total; cliff=100, end=200
    ledger_at(&env, 200);
    client.withdraw(&stream_id, &receiver);

    let id1 =
        client.request_clawback(&stream_id, &sender, &100_i128, &reason(&env), &1_u32, &0_u64);
    let id2 =
        client.request_clawback(&stream_id, &sender, &200_i128, &reason(&env), &1_u32, &0_u64);

    assert_ne!(id1, id2);
    let req1 = client.get_clawback_request(&id1).unwrap();
    let req2 = client.get_clawback_request(&id2).unwrap();
    assert_eq!(req1.amount, 100);
    assert_eq!(req2.amount, 200);
}

// ---------------------------------------------------------------------------
// Test 8: partial clawback (less than full withdrawn amount)
// ---------------------------------------------------------------------------
#[test]
fn test_partial_clawback() {
    let (env, client, admin) = setup();
    let sender = Address::generate(&env);
    let receiver = Address::generate(&env);
    let token = mint_token(&env, &admin, &sender, 1000);

    let stream_id = create_clawback_stream(&env, &client, &sender, &receiver, &token);
    ledger_at(&env, 200);
    client.withdraw(&stream_id, &receiver); // withdraws 1000

    // Only claw back half
    let clawback_id =
        client.request_clawback(&stream_id, &sender, &250_i128, &reason(&env), &1_u32, &0_u64);
    client.approve_clawback(&clawback_id, &receiver);
    client.execute_clawback(&clawback_id, &sender);

    let token_client = TokenClient::new(&env, &token);
    assert_eq!(token_client.balance(&sender), 250);
    assert_eq!(token_client.balance(&receiver), 750);
}

// ---------------------------------------------------------------------------
// Test 9: expired request cannot be approved
// ---------------------------------------------------------------------------
#[test]
#[should_panic(expected = "Error(Contract, #44)")]
fn test_expired_request_cannot_be_approved() {
    let (env, client, admin) = setup();
    let sender = Address::generate(&env);
    let receiver = Address::generate(&env);
    let token = mint_token(&env, &admin, &sender, 1000);

    let stream_id = create_clawback_stream(&env, &client, &sender, &receiver, &token);
    ledger_at(&env, 150);
    client.withdraw(&stream_id, &receiver);

    // Request expires at t=160
    let clawback_id =
        client.request_clawback(&stream_id, &sender, &100_i128, &reason(&env), &1_u32, &160_u64);

    // Advance past expiry
    ledger_at(&env, 200);

    // Should panic with ClawbackExpired (#44)
    client.approve_clawback(&clawback_id, &receiver);
}

// ---------------------------------------------------------------------------
// Test 10: expired request cannot be executed (even if Approved)
// ---------------------------------------------------------------------------
#[test]
#[should_panic(expected = "Error(Contract, #44)")]
fn test_expired_approved_request_cannot_be_executed() {
    let (env, client, admin) = setup();
    let sender = Address::generate(&env);
    let receiver = Address::generate(&env);
    let token = mint_token(&env, &admin, &sender, 1000);

    let stream_id = create_clawback_stream(&env, &client, &sender, &receiver, &token);
    ledger_at(&env, 150);
    client.withdraw(&stream_id, &receiver);

    // Request expires at t=160; approve at t=150 (before expiry)
    let clawback_id =
        client.request_clawback(&stream_id, &sender, &100_i128, &reason(&env), &1_u32, &160_u64);
    client.approve_clawback(&clawback_id, &receiver); // sets Approved at t=150

    // Advance past expiry
    ledger_at(&env, 200);

    // execute_clawback checks expiry even after Approved – should panic with ClawbackExpired (#44)
    client.execute_clawback(&clawback_id, &sender);
}

// ---------------------------------------------------------------------------
// Test 11: clawback not enabled on stream is rejected
// ---------------------------------------------------------------------------
#[test]
#[should_panic(expected = "Error(Contract, #39)")]
fn test_clawback_not_enabled_rejected() {
    let (env, client, admin) = setup();
    let sender = Address::generate(&env);
    let receiver = Address::generate(&env);
    let token = mint_token(&env, &admin, &sender, 1000);

    // create_stream always passes clawback_enabled:false
    let stream_id = client.create_stream(
        &sender,
        &receiver,
        &token,
        &1000_i128,
        &100_u64,
        &100_u64,
        &200_u64,
        &CurveType::Linear,
        &false,
    );
    ledger_at(&env, 150);
    client.withdraw(&stream_id, &receiver);

    // Should panic with ClawbackNotEnabled (#39)
    client.request_clawback(&stream_id, &sender, &100_i128, &reason(&env), &1_u32, &0_u64);
}

// ---------------------------------------------------------------------------
// Test 12: double-execute is rejected
// ---------------------------------------------------------------------------
#[test]
#[should_panic(expected = "Error(Contract, #41)")]
fn test_double_execute_rejected() {
    let (env, client, admin) = setup();
    let sender = Address::generate(&env);
    let receiver = Address::generate(&env);
    let token = mint_token(&env, &admin, &sender, 1000);

    let stream_id = create_clawback_stream(&env, &client, &sender, &receiver, &token);
    ledger_at(&env, 200);
    client.withdraw(&stream_id, &receiver);

    let clawback_id =
        client.request_clawback(&stream_id, &sender, &200_i128, &reason(&env), &1_u32, &0_u64);
    client.approve_clawback(&clawback_id, &receiver);
    client.execute_clawback(&clawback_id, &sender);

    // Second execute – should panic with ClawbackAlreadyExecuted (#41)
    client.execute_clawback(&clawback_id, &sender);
}

// ---------------------------------------------------------------------------
// Test 13: double-approve by same address is rejected
// ---------------------------------------------------------------------------
#[test]
#[should_panic(expected = "Error(Contract, #43)")]
fn test_double_approve_rejected() {
    let (env, client, admin) = setup();
    let sender = Address::generate(&env);
    let receiver = Address::generate(&env);
    let token = mint_token(&env, &admin, &sender, 1000);
    let gov = Address::generate(&env);

    let stream_id = create_clawback_stream(&env, &client, &sender, &receiver, &token);
    ledger_at(&env, 150);
    client.withdraw(&stream_id, &receiver);

    let clawback_id =
        client.request_clawback(&stream_id, &sender, &100_i128, &reason(&env), &2_u32, &0_u64);
    client.approve_clawback(&clawback_id, &gov);
    // Second approval by same address – should panic with ClawbackAlreadyApproved (#43)
    client.approve_clawback(&clawback_id, &gov);
}

// ---------------------------------------------------------------------------
// Test 14: only sender can request clawback
// ---------------------------------------------------------------------------
#[test]
#[should_panic(expected = "Error(Contract, #5)")]
fn test_non_sender_cannot_request_clawback() {
    let (env, client, admin) = setup();
    let sender = Address::generate(&env);
    let receiver = Address::generate(&env);
    let stranger = Address::generate(&env);
    let token = mint_token(&env, &admin, &sender, 1000);

    let stream_id = create_clawback_stream(&env, &client, &sender, &receiver, &token);
    ledger_at(&env, 150);
    client.withdraw(&stream_id, &receiver);

    // Stranger tries to request clawback – should panic with Unauthorized (#5)
    client.request_clawback(&stream_id, &stranger, &100_i128, &reason(&env), &1_u32, &0_u64);
}

// ---------------------------------------------------------------------------
// Test 15: get_clawback_request returns None for unknown id
// ---------------------------------------------------------------------------
#[test]
fn test_get_nonexistent_clawback_returns_none() {
    let (_env, client, _admin) = setup();
    let result = client.get_clawback_request(&9999_u64);
    assert!(result.is_none());
}
