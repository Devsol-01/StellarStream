use soroban_sdk::{contracttype, Address};

#[contracttype]
#[derive(Clone, PartialEq)]
pub enum DataKey {
    Admin,
    Token,
    NextEscrowId,
    Escrow(u64),
    Party(u64, Address),
    Approval(u64, Address),
    Dispute(u64),
    Nonce(Address),
}
