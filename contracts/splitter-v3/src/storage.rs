use soroban_sdk::{contracttype, Address, BytesN};

#[contracttype]
#[derive(Clone, PartialEq)]
pub enum DataKey {
    Admin,
    QuorumAdmins,
    NextProposalId,
    // #1484: consolidated read-mostly protocol configuration (token, fee_bps,
    // treasury, strict_mode, contract state, whitelist mode, identity
    // validator) stored as a single instance entry to cut down storage reads
    // on the hot split paths.
    Config,
    VerifiedUsers(Address),
    Proposal(u64),
    NextSplitId,
    ScheduledSplit(u64),
    ClaimableBalance(Address, Address),
    CouncilKeys,
    AffiliateAddress,
    AffiliateBps,
    PendingWithdrawal(Address),
    ProcessedHash(BytesN<32>),
    SplitFundsNextIndex,
    // #924: migration version to prevent re-running migration logic
    MigrationVersion,
    // #927: whitelist map (the whitelist-only flag moved into Config)
    Whitelisted(Address),
    // #911: protocol-level version constant
    ProtocolVersion,
    // #911: protocol fee wallet (alias for Treasury used in init)
    FeeWallet,
    // #913: reentrancy guard — stored in *temporary* storage (see #1484):
    // set to true while split_funds is executing so ephemeral lock state
    // doesn't consume an instance-storage entry.
    Locked,
    // #916: multi-sig admin change proposals
    AdminProposal(u64),
    NextAdminProposalId,
    /// Minimum approvals required to execute a sensitive admin action.
    AdminThreshold,
}
