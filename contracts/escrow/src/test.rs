#![cfg(test)]

use soroban_sdk::{
    contract, contractimpl, symbol_short, testutils::Address as _, token, Address, Env, String as SorString, Vec,
};

use crate::{EscrowContract, EscrowContractClient, EscrowData, EscrowState, ReleaseCondition};

fn setup_test() -> (Env, Address, Address, Address) {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let depositor = Address::generate(&env);
    let recipient = Address::generate(&env);

    // Deploy token contract
    let token_admin = Address::generate(&env);
    let token = env.register_stellar_asset_contract(token_admin.clone());

    // Initialize escrow contract
    let contract_id = env.register_contract(None, EscrowContract);
    let client = EscrowContractClient::new(&env, &contract_id);

    client.initialize(&admin, &token.address());

    // Fund depositor with tokens
    let token_client = token::Client::new(&env, &token.address());
    token_client.mint(&depositor, &1000_0000000);

    (env, contract_id, depositor, recipient)
}

#[test]
fn test_initialize() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let token = env.register_stellar_asset_contract(admin.clone());
    let contract_id = env.register_contract(None, EscrowContract);
    let client = EscrowContractClient::new(&env, &contract_id);

    client.initialize(&admin, &token.address());

    assert_eq!(client.get_admin(), admin);
    assert_eq!(client.get_token(), token.address());
    assert_eq!(client.version(), 1);
}

#[test]
#[should_panic(expected = "already initialized")]
fn test_double_initialize() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let token = env.register_stellar_asset_contract(admin.clone());
    let contract_id = env.register_contract(None, EscrowContract);
    let client = EscrowContractClient::new(&env, &contract_id);

    client.initialize(&admin, &token.address());
    client.initialize(&admin, &token.address());
}

#[test]
fn test_create_escrow() {
    let (env, contract_id, depositor, recipient) = setup_test();
    let client = EscrowContractClient::new(&env, &contract_id);

    let condition = ReleaseCondition::TimeLock {
        release_timestamp: env.ledger().timestamp() + 1000,
    };

    let escrow_id = client.create_escrow(&depositor, &recipient, &None, &500_0000000, &condition, &None);

    let escrow = client.get_escrow(&escrow_id).unwrap();
    assert_eq!(escrow.state, EscrowState::PendingFunding);
    assert_eq!(escrow.depositor, depositor);
    assert_eq!(escrow.recipient, recipient);
    assert_eq!(escrow.amount, 500_0000000);
}

#[test]
fn test_fund_escrow() {
    let (env, contract_id, depositor, recipient) = setup_test();
    let client = EscrowContractClient::new(&env, &contract_id);

    let condition = ReleaseCondition::TimeLock {
        release_timestamp: env.ledger().timestamp() + 1000,
    };

    let escrow_id = client.create_escrow(&depositor, &recipient, &None, &500_0000000, &condition, &None);
    client.fund(&escrow_id);

    let escrow = client.get_escrow(&escrow_id).unwrap();
    assert_eq!(escrow.state, EscrowState::Active);
}

#[test]
fn test_release_time_lock() {
    let (env, contract_id, depositor, recipient) = setup_test();
    let client = EscrowContractClient::new(&env, &contract_id);

    let release_timestamp = env.ledger().timestamp() + 1;
    let condition = ReleaseCondition::TimeLock { release_timestamp };

    let escrow_id = client.create_escrow(&depositor, &recipient, &None, &500_0000000, &condition, &None);
    client.fund(&escrow_id);

    // Jump past the release time
    env.ledger().set_timestamp(release_timestamp + 1);

    client.release(&escrow_id);

    let escrow = client.get_escrow(&escrow_id).unwrap();
    assert_eq!(escrow.state, EscrowState::Released);
}

#[test]
#[should_panic(expected = "release time not yet reached")]
fn test_release_before_time_lock() {
    let (env, contract_id, depositor, recipient) = setup_test();
    let client = EscrowContractClient::new(&env, &contract_id);

    let release_timestamp = env.ledger().timestamp() + 1000;
    let condition = ReleaseCondition::TimeLock { release_timestamp };

    let escrow_id = client.create_escrow(&depositor, &recipient, &None, &500_0000000, &condition, &None);
    client.fund(&escrow_id);

    // Try to release before time lock expires
    client.release(&escrow_id);
}

#[test]
fn test_refund() {
    let (env, contract_id, depositor, recipient) = setup_test();
    let client = EscrowContractClient::new(&env, &contract_id);

    let condition = ReleaseCondition::TimeLock {
        release_timestamp: env.ledger().timestamp() + 1000,
    };

    let escrow_id = client.create_escrow(&depositor, &recipient, &None, &500_0000000, &condition, &None);
    client.fund(&escrow_id);

    client.refund(&escrow_id);

    let escrow = client.get_escrow(&escrow_id).unwrap();
    assert_eq!(escrow.state, EscrowState::Refunded);
}

#[test]
fn test_dispute_and_resolve_release() {
    let (env, contract_id, depositor, recipient) = setup_test();
    let client = EscrowContractClient::new(&env, &contract_id);

    let arbiter = Address::generate(&env);

    let condition = ReleaseCondition::Milestone {
        description: SorString::from_str(&env, "Deliver Q1 report"),
    };

    let escrow_id = client.create_escrow(&depositor, &recipient, &Some(arbiter.clone()), &500_0000000, &condition, &None);
    client.fund(&escrow_id);

    // Raise dispute
    let reason = SorString::from_str(&env, "Work not completed");
    client.raise_dispute(&escrow_id, &recipient, &reason);

    let escrow = client.get_escrow(&escrow_id).unwrap();
    assert_eq!(escrow.state, EscrowState::Disputed);

    // Arbiter resolves in favor of recipient (1 = release)
    client.resolve_dispute(&escrow_id, &1, &arbiter);

    let escrow = client.get_escrow(&escrow_id).unwrap();
    assert_eq!(escrow.state, EscrowState::Released);
}

#[test]
fn test_dispute_and_resolve_refund() {
    let (env, contract_id, depositor, recipient) = setup_test();
    let client = EscrowContractClient::new(&env, &contract_id);

    let arbiter = Address::generate(&env);

    let condition = ReleaseCondition::Milestone {
        description: SorString::from_str(&env, "Deliver Q1 report"),
    };

    let escrow_id = client.create_escrow(&depositor, &recipient, &Some(arbiter.clone()), &500_0000000, &condition, &None);
    client.fund(&escrow_id);

    // Raise dispute
    let reason = SorString::from_str(&env, "Work not completed");
    client.raise_dispute(&escrow_id, &depositor, &reason);

    // Arbiter resolves in favor of depositor (2 = refund)
    client.resolve_dispute(&escrow_id, &2, &arbiter);

    let escrow = client.get_escrow(&escrow_id).unwrap();
    assert_eq!(escrow.state, EscrowState::Refunded);
}

#[test]
fn test_cancel_unfunded_escrow() {
    let (env, contract_id, depositor, recipient) = setup_test();
    let client = EscrowContractClient::new(&env, &contract_id);

    let condition = ReleaseCondition::TimeLock {
        release_timestamp: env.ledger().timestamp() + 1000,
    };

    let escrow_id = client.create_escrow(&depositor, &recipient, &None, &500_0000000, &condition, &None);
    client.cancel(&escrow_id);

    let escrow = client.get_escrow(&escrow_id).unwrap();
    assert_eq!(escrow.state, EscrowState::Cancelled);
}

#[test]
fn test_multi_sig_approve_and_release() {
    let (env, contract_id, depositor, recipient) = setup_test();
    let client = EscrowContractClient::new(&env, &contract_id);

    let approver1 = Address::generate(&env);
    let approver2 = Address::generate(&env);
    let approver3 = Address::generate(&env);

    let approvers = Vec::from_array(&env, [approver1.clone(), approver2.clone(), approver3.clone()]);

    let condition = ReleaseCondition::MultiSig {
        approvers: approvers.clone(),
        threshold: 2,
    };

    let escrow_id = client.create_escrow(&depositor, &recipient, &None, &500_0000000, &condition, &None);
    client.fund(&escrow_id);

    // First approver
    client.approve_release(&escrow_id, &approver1);
    assert!(client.get_approval(&escrow_id, &approver1));

    // Second approver - threshold met
    client.approve_release(&escrow_id, &approver2);
    assert!(client.get_approval(&escrow_id, &approver2));

    // Release should succeed
    client.release(&escrow_id);

    let escrow = client.get_escrow(&escrow_id).unwrap();
    assert_eq!(escrow.state, EscrowState::Released);
}

#[test]
#[should_panic(expected = "quorum not reached")]
fn test_multi_sig_release_without_quorum() {
    let (env, contract_id, depositor, recipient) = setup_test();
    let client = EscrowContractClient::new(&env, &contract_id);

    let approver1 = Address::generate(&env);
    let approver2 = Address::generate(&env);

    let approvers = Vec::from_array(&env, [approver1.clone(), approver2.clone()]);

    let condition = ReleaseCondition::MultiSig {
        approvers,
        threshold: 2,
    };

    let escrow_id = client.create_escrow(&depositor, &recipient, &None, &500_0000000, &condition, &None);
    client.fund(&escrow_id);

    // Only one approval, need 2
    client.approve_release(&escrow_id, &approver1);
    client.release(&escrow_id);
}
