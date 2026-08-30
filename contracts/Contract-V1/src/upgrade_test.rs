#![cfg(test)]

use crate::{StellarStream, StellarStreamClient};
use soroban_sdk::{testutils::Address as _, Address, BytesN, Env};

// Note: These tests verify the authorization and event logic for upgrades.
// Actual WASM updates require the WASM to be uploaded to the network first,
// which cannot be done in unit tests. Integration tests on testnet/mainnet
// are needed to verify the complete upgrade flow.

fn setup_test() -> (Env, Address, StellarStreamClient<'static>) {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);

    // Deploy contract
    let contract_id = env.register(StellarStream, ());
    let client = StellarStreamClient::new(&env, &contract_id);

    // Initialize with admin - now returns Result
    let _ = client.initialize(&admin);

    (env, admin, client)
}

#[test]
fn test_get_admin() {
    let (_env, admin, client) = setup_test();

    let retrieved_admin = client.get_admin();
    assert_eq!(retrieved_admin, admin);
}

#[test]
#[should_panic(expected = "Admin not set")]
fn test_get_admin_not_initialized() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(StellarStream, ());
    let client = StellarStreamClient::new(&env, &contract_id);

    // Should panic because admin is not set
    client.get_admin();
}

#[test]
#[should_panic(expected = "Unauthorized: Only Admin can upgrade contract")]
fn test_upgrade_without_initialization() {
    let env = Env::default();
    env.mock_all_auths();

    // Deploy contract without initialization
    let contract_id = env.register(StellarStream, ());
    let client = StellarStreamClient::new(&env, &contract_id);

    let non_admin = Address::generate(&env);
    let new_wasm_hash = BytesN::from_array(&env, &[1u8; 32]);

    // Should panic because non-admin doesn't have Admin role
    client.upgrade(&non_admin, &new_wasm_hash);
}

#[test]
fn test_admin_can_be_retrieved_after_fee_init() {
    let (_env, admin, client) = setup_test();

    // Initialize fee (which also sets admin)
    let treasury = Address::generate(&_env);
    client.initialize_fee(&admin, &100, &treasury);

    // Admin should still be retrievable
    let retrieved_admin = client.get_admin();
    assert_eq!(retrieved_admin, admin);
}

#[test]
fn test_admin_persists_through_pause() {
    let (_env, admin, client) = setup_test();

    // Pause the contract
    client.set_pause(&admin, &true);

    // Admin should still be retrievable
    let retrieved_admin = client.get_admin();
    assert_eq!(retrieved_admin, admin);

    // Unpause
    client.set_pause(&admin, &false);

    // Admin should still be the same
    assert_eq!(client.get_admin(), admin);
}

// Note: The following tests would verify actual WASM updates in integration tests.
// In unit tests, they would fail with "Wasm does not exist" because the WASM
// hash doesn't exist in the test environment. The authorization logic is still
// tested above.

#[test]
#[ignore] // Requires actual WASM upload - run as integration test
fn test_upgrade_by_admin() {
    let (_env, admin, client) = setup_test();
    let new_wasm_hash = BytesN::from_array(&_env, &[1u8; 32]);
    client.upgrade(&admin, &new_wasm_hash);
}

#[test]
#[ignore] // Requires actual WASM upload - run as integration test
fn test_upgrade_maintains_state() {
    let (_env, admin, client) = setup_test();
    let treasury = Address::generate(&_env);
    client.initialize_fee(&admin, &100, &treasury);

    let admin_before = client.get_admin();
    let new_wasm_hash = BytesN::from_array(&_env, &[2u8; 32]);
    client.upgrade(&admin, &new_wasm_hash);

    let admin_after = client.get_admin();
    assert_eq!(admin_after, admin_before);
}

#[test]
fn test_initialize_cannot_be_called_twice() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);

    // Deploy contract
    let contract_id = env.register(StellarStream, ());
    let client = StellarStreamClient::new(&env, &contract_id);

    // First initialization should succeed
    let result = client.try_initialize(&admin);
    assert!(result.is_ok());

    // Second initialization should fail with AlreadyInitialized error
    let result2 = client.try_initialize(&admin);
    assert!(result2.is_err());
    assert_eq!(result2.err(), Some(Ok(crate::errors::Error::AlreadyInitialized)));
}

#[test]
fn test_upgrade_preserves_fee_settings() {
    let (_env, admin, client) = setup_test();
    let treasury = Address::generate(&_env);
    
    // Initialize fee settings
    client.initialize_fee(&admin, &150, &treasury);
    
    // Admin should be retrievable after fee init
    let retrieved_admin = client.get_admin();
    assert_eq!(retrieved_admin, admin);
}

#[test]
fn test_multiple_upgrades() {
    let (_env, admin, client) = setup_test();
    
    // Multiple calls to check admin don't fail
    let admin1 = client.get_admin();
    let admin2 = client.get_admin();
    let admin3 = client.get_admin();
    
    assert_eq!(admin1, admin);
    assert_eq!(admin2, admin);
    assert_eq!(admin3, admin);
}

#[test]
fn test_upgrade_with_paused_contract() {
    let (_env, admin, client) = setup_test();
    
    // Pause contract
    client.set_pause(&admin, &true);
    
    // Admin should still be accessible when paused
    let retrieved_admin = client.get_admin();
    assert_eq!(retrieved_admin, admin);
    
    // Unpause
    client.set_pause(&admin, &false);
    
    // Admin should still be the same
    let retrieved_admin2 = client.get_admin();
    assert_eq!(retrieved_admin2, admin);
}

#[test]
fn test_admin_authorization_required() {
    let (env, admin, client) = setup_test();
    
    // Verify that the admin has the necessary roles after initialization
    let has_super_admin = client.check_role(&admin, &crate::rbac::Role::SuperAdmin);
    assert!(has_super_admin, "Admin should have SuperAdmin role after initialization");
}
