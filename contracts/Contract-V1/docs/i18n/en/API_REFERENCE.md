# StellarStream API Reference

**Languages:** [English](./API_REFERENCE.md) · [Español](../es/API_REFERENCE.md) · [中文](../zh/API_REFERENCE.md) · [日本語](../ja/API_REFERENCE.md)

> This is the English (source) version of the StellarStream API Reference. Translations are maintained in the language folders of this directory. If you find a discrepancy, the English version is authoritative.

---

## 1. Data Structures

### Stream

```rust
pub struct Stream {
    pub sender: Address,           // Who created the stream
    pub receiver: Address,         // Who receives the tokens
    pub token: Address,            // Token contract address
    pub total_amount: i128,        // Total tokens to stream
    pub start_time: u64,           // When streaming begins
    pub end_time: u64,             // When streaming ends
    pub withdrawn_amount: i128,    // Already withdrawn tokens
    pub state: StreamState,        // Active, Paused, or Closed
    pub curve_type: CurveType,     // Linear or Exponential
    pub is_soulbound: bool,        // Transfer restriction
    // ... additional fields for advanced features
}
```

### Key Enums

```rust
pub enum CurveType {
    Linear = 0,      // Proportional unlocking
    Exponential = 1, // Quadratic acceleration
}

pub enum StreamState {
    Active = 0,      // Tokens are vesting normally
    Paused = 1,      // Vesting is suspended
    Closed = 2,      // Stream is cancelled/ended
}

pub enum Role {
    Admin,           // Full permissions
    Pauser,          // Emergency controls
    TreasuryManager, // Fee management
}
```

### Storage Architecture

- **Instance Storage**: Contract configuration, admin settings
- **Persistent Storage**: Individual streams, user data
- **Temporary Storage**: Re-entrancy locks, flash loan states

---

## 2. Core Functions

### Stream Management

```rust
// Create a new stream
pub fn create_stream(
    env: Env,
    sender: Address,
    receiver: Address,
    token: Address,
    total_amount: i128,
    start_time: u64,
    end_time: u64,
    curve_type: CurveType,
    is_soulbound: bool,
) -> Result<u64, Error>

// Withdraw unlocked tokens
pub fn withdraw(
    env: Env,
    stream_id: u64,
    receiver: Address,
) -> Result<i128, Error>

// Cancel stream early
pub fn cancel_stream(
    env: Env,
    stream_id: u64,
    sender: Address,
) -> Result<(), Error>

// Pause a stream (stops vesting, only sender)
pub fn pause_stream(
    env: Env,
    stream_id: u64,
    caller: Address,
) -> Result<(), Error>

// Resume a paused stream (restores vesting)
pub fn resume_stream(
    env: Env,
    stream_id: u64,
    caller: Address,
) -> Result<(), Error>
```

### Multi-Signature Proposals

```rust
// Create proposal for treasury streams
pub fn create_proposal(
    env: Env,
    sender: Address,
    receiver: Address,
    token: Address,
    total_amount: i128,
    start_time: u64,
    end_time: u64,
    required_approvals: u32,
    deadline: u64,
) -> Result<u64, Error>

// Approve proposal (auto-executes when threshold met)
pub fn approve_proposal(
    env: Env,
    proposal_id: u64,
    approver: Address,
) -> Result<(), Error>
```

### Administrative Functions

```rust
// RBAC management
pub fn grant_role(env: Env, admin: Address, account: Address, role: Role)
pub fn revoke_role(env: Env, admin: Address, account: Address, role: Role)

// OFAC compliance
pub fn restrict_address(env: Env, admin: Address, target: Address)
pub fn unrestrict_address(env: Env, admin: Address, target: Address)

// Emergency controls
pub fn pause_contract(env: Env, pauser: Address)
pub fn unpause_contract(env: Env, pauser: Address)

// Upgrades and migration
pub fn upgrade(env: Env, admin: Address, new_wasm_hash: BytesN<32>)
pub fn migrate(env: Env, admin: Address, target_version: u32)
```

---

## 3. Query Functions

```rust
// Get stream details
pub fn get_stream(env: Env, stream_id: u64) -> Result<Stream, Error>

// Calculate current unlocked amount
pub fn get_unlocked_amount(env: Env, stream_id: u64) -> Result<i128, Error>

// Check withdrawable balance
pub fn get_withdrawable_amount(env: Env, stream_id: u64) -> Result<i128, Error>

// Get user's streams
pub fn get_user_streams(env: Env, user: Address) -> Vec<u64>

// Check current contract version
pub fn get_version(env: Env) -> u32
```

---

## 4. Error Reference

```rust
pub enum Error {
    AlreadyInitialized = 1,      // Contract already set up
    InvalidTimeRange = 2,        // start_time >= end_time
    InvalidAmount = 3,           // amount <= 0
    StreamNotFound = 4,          // Invalid stream_id
    Unauthorized = 5,            // Missing permissions
    AlreadyCancelled = 6,        // Stream already cancelled
    InsufficientBalance = 7,     // Not enough tokens
    StreamPaused = 14,           // Cannot withdraw while paused
    StreamIsSoulbound = 21,      // Transfer not allowed
    AddressRestricted = 22,      // OFAC compliance violation
    StreamNotPaused = 26,        // Cannot resume an active stream
    // ... 26 total error types
}
```

### Error Handling Patterns

```rust
// Result-based error handling
match create_stream(&env, sender, receiver, token, amount, start, end, curve, false) {
    Ok(stream_id) => {
        // Stream created successfully
        log!(&env, "Stream {} created", stream_id);
    },
    Err(Error::InvalidAmount) => {
        // Handle invalid amount
        panic_with_error!(&env, Error::InvalidAmount);
    },
    Err(e) => {
        // Handle other errors
        panic_with_error!(&env, e);
    }
}
```

---

## 5. Versioning & Compatibility

- Contract versions are tracked with `get_version`.
- Schema migrations preserve stream balances, withdrawn amounts, and user permissions.
- Upgrades require the `Admin` role and a valid new WASM hash.

---

*Built with ❤️ for the Stellar ecosystem.*
