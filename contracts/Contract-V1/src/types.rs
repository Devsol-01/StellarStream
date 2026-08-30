pub use crate::rbac::Role;
use soroban_sdk::{contracttype, Address, BytesN, Vec};

// Interest distribution strategies
// Bits can be combined: e.g., 0b011 = 50% sender, 50% receiver
#[allow(dead_code)]
pub const INTEREST_TO_SENDER: u32 = 0b001; // 1: All interest to sender
#[allow(dead_code)]
pub const INTEREST_TO_RECEIVER: u32 = 0b010; // 2: All interest to receiver
#[allow(dead_code)]
pub const INTEREST_TO_PROTOCOL: u32 = 0b100; // 4: All interest to protocol

// Common strategy combinations (exported for convenience)
#[allow(dead_code)]
pub const INTEREST_SPLIT_SENDER_RECEIVER: u32 = 0b011; // 3: 50/50 sender/receiver
#[allow(dead_code)]
pub const INTEREST_SPLIT_ALL: u32 = 0b111; // 7: 33/33/33 split

// Stream states
/// Represents the current operational state of a payment stream.
///
/// Valid states are intentionally stored as explicit `u32` discriminants to keep
/// the data compact in Soroban storage while remaining easy to inspect in code.
#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum StreamState {
    Active = 0,
    Paused = 1,
    Closed = 2,
}

// Curve types for vesting schedules
/// Defines the vesting curve type that determines how funds unlock over time.
#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum CurveType {
    Linear = 0,
    Exponential = 1,
}

/// Represents a single payment stream between two addresses.
///
/// A stream encodes the sender, receiver, token, amount, timing, and ongoing
/// state required to calculate how much of the total has been unlocked and/or
/// already withdrawn.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Stream {
    pub sender: Address,
    pub receiver: Address,
    pub token: Address,
    pub total_amount: i128,
    pub start_time: u64,
    pub end_time: u64,
    pub withdrawn_amount: i128,
    pub state: StreamState,
    pub curve_type: CurveType,
    pub is_soulbound: bool,
    pub cliff_time: Option<u64>,
    pub paused_duration: u64,
}

/// User profile tracking all incoming and outgoing payment streams.
///
/// This record makes it efficient to look up the stream IDs associated with a
/// given account without scanning every stream in storage.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct UserProfile {
    pub outgoing_streams: Vec<u64>,
    pub incoming_streams: Vec<u64>,
}

// Legacy Stream struct (v1) - for migration example
// This represents an older version without cliff_time
#[contracttype]
#[derive(Clone)]
pub struct StreamProposal {
    pub sender: Address,
    pub receiver: Address,
    pub token: Address,
    pub total_amount: i128,
    pub start_time: u64,
    pub end_time: u64,
    pub approvers: Vec<Address>,
    pub required_approvals: u32,
    pub deadline: u64,
    pub executed: bool,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct StreamRequest {
    pub receiver: Address,
    pub amount: i128,
    pub start_time: u64,
    pub cliff_time: u64,
    pub end_time: u64,
    pub interest_strategy: u32,
    pub vault_address: Option<Address>,
    pub metadata: Option<BytesN<32>>,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct InterestDistribution {
    pub to_sender: i128,
    pub to_receiver: i128,
    pub to_protocol: i128,
    pub total_interest: i128,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DataKey {
    Stream(u64),
    StreamId,
    Admin, // Kept for backward compatibility
    FeeBps,
    Treasury,
    IsPaused,
    ReentrancyLock,
    ContractVersion,        // Tracks current contract version
    MigrationExecuted(u32), // Tracks which migrations have been executed
    Role(Address, Role),    // RBAC: stores role assignments
    SoulboundStreams,       // Vec<u64> of all soulbound stream IDs
    ApprovedVaults,         // Vec<Address> of approved lending vaults
    VaultShares(u64),       // Vault shares for stream_id
    VotingDelegate(u64),    // Voting delegate for stream_id
    Initialized,            // Tracks whether contract has been initialized
}

/// Parameters for creating a stream with milestones.
/// This struct bundles multiple parameters to avoid exceeding
/// Soroban's 10-parameter limit for contract functions.
#[contracttype]
#[derive(Clone, Debug)]
pub struct StreamParams {
    pub sender: Address,
    pub receiver: Address,
    pub token: Address,
    pub total_amount: i128,
    pub start_time: u64,
    pub cliff_time: u64,
    pub end_time: u64,
    pub milestones: Vec<Milestone>,
    pub curve_type: CurveType,
    pub is_soulbound: bool,
    pub vault_address: Option<Address>,
}

/// User profile tracking all incoming and outgoing payment streams.
/// Enables efficient lookup of all streams associated with a user address.
/// Used for dashboard views and stream management interfaces.
/// 
/// # Storage Considerations
/// This structure grows linearly with the number of streams per user.
/// For users with many streams, consider pagination in query functions.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct UserProfile {
    /// List of stream IDs where this user is the sender/payer
    pub outgoing_streams: Vec<u64>,
    /// List of stream IDs where this user is the receiver/beneficiary
    pub incoming_streams: Vec<u64>,
}

#[contracttype]
#[derive(Clone)]
pub struct StreamReceipt {
    pub stream_id: u64,
    pub owner: Address,
    pub minted_at: u64,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct StreamCreatedEvent {
    pub stream_id: u64,
    pub sender: Address,
    pub receiver: Address,
    pub token: Address,
    pub total_amount: i128,
    pub start_time: u64,
    pub end_time: u64,
    pub timestamp: u64,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct StreamClaimEvent {
    pub stream_id: u64,
    pub claimer: Address,
    pub amount: i128,
    pub total_claimed: i128,
    pub timestamp: u64,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct StreamCancelledEvent {
    pub stream_id: u64,
    pub canceller: Address,
    pub to_receiver: i128,
    pub to_sender: i128,
    pub timestamp: u64,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct ClawbackEvent {
    pub stream_id: u64,
    pub officer: Address,
    pub amount_clawed: i128,
    pub issuer: Address,
    pub reason: Option<BytesN<32>>,
    pub timestamp: u64,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct StreamFrozenEvent {
    pub stream_id: u64,
    pub arbiter: Address,
    pub timestamp: u64,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct DisputeResolvedEvent {
    pub stream_id: u64,
    pub arbiter: Address,
    pub to_sender: i128,
    pub to_receiver: i128,
    pub timestamp: u64,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct StreamToppedUpEvent {
    pub stream_id: u64,
    pub sender: Address,
    pub amount: i128,
    pub new_total: i128,
    pub new_end_time: u64,
    pub timestamp: u64,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct ReceiptTransferredEvent {
    pub stream_id: u64,
    pub from: Address,
    pub to: Address,
    pub timestamp: u64,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct StreamPausedEvent {
    pub stream_id: u64,
    pub pauser: Address,
    pub timestamp: u64,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct StreamUnpausedEvent {
    pub stream_id: u64,
    pub unpauser: Address,
    pub paused_duration: u64,
    pub timestamp: u64,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct StreamResumedEvent {
    pub stream_id: u64,
    pub resumer: Address,
    pub paused_duration: u64,
    pub timestamp: u64,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct ProposalApprovedEvent {
    pub proposal_id: u64,
    pub approver: Address,
    pub approval_count: u32,
    pub required_approvals: u32,
    pub timestamp: u64,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct ProposalCreatedEvent {
    pub proposal_id: u64,
    pub sender: Address,
    pub receiver: Address,
    pub token: Address,
    pub total_amount: i128,
    pub start_time: u64,
    pub end_time: u64,
    pub required_approvals: u32,
    pub deadline: u64,
    pub timestamp: u64,
}

#[contracttype]
#[derive(Clone)]
pub struct ReceiptMetadata {
    pub stream_id: u64,
    pub locked_balance: i128,
    pub unlocked_balance: i128,
    pub total_amount: i128,
    pub token: Address,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum RequestStatus {
    Pending,
    Approved,
    Rejected,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ContributorRequest {
    pub id: u64,
    pub receiver: Address,
    pub token: Address,
    pub total_amount: i128,
    pub duration: u64,
    pub start_time: u64,
    pub status: RequestStatus,
    pub metadata: Option<BytesN<32>>,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum RequestKey {
    Request(u64),
    RequestCount,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct RequestCreatedEvent {
    pub request_id: u64,
    pub receiver: Address,
    pub token: Address,
    pub total_amount: i128,
    pub duration: u64,
    pub timestamp: u64,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct RequestExecutedEvent {
    pub request_id: u64,
    pub stream_id: u64,
    pub executor: Address,
    pub timestamp: u64,
}
