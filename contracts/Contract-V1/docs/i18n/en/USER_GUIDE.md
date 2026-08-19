# StellarStream User Guide

**Languages:** [English](./USER_GUIDE.md) · [Español](../es/USER_GUIDE.md) · [中文](../zh/USER_GUIDE.md) · [日本語](../ja/USER_GUIDE.md)

> This is the English (source) version of the StellarStream User Guide. Translations are maintained in the language folders of this directory. If you find a discrepancy, the English version is authoritative.

---

## 1. What is StellarStream?

StellarStream is a real-time asset streaming protocol built on Stellar/Soroban. It transforms traditional lump-sum payments into continuous streams.

Instead of paying $1,000 in a single transaction, you can stream $1,000 over 30 days, unlocking roughly $33.33 per day as time passes.

```
Traditional: [----$1000----] (paid once)
Streaming:   [$33][$33][$33]... (unlocks continuously)
```

The contract calculates unlocked amounts using precise mathematical formulas, allowing receivers to withdraw their earned portion at any time.

---

## 2. Core Concepts

- **Stream**: A continuous payment arrangement between a sender and a receiver, denominated in a token.
- **Sender**: The account that funds the stream.
- **Receiver**: The account that withdraws the unlocked tokens over time.
- **Vesting**: The process by which tokens become available to the receiver as time passes.
- **Cliff**: An optional period during which nothing unlocks; after the cliff, vesting begins normally.

### Stream Lifecycle

1. **Create** — The sender creates a stream with a token, total amount, start time, end time, and vesting curve.
2. **Active** — Tokens vest normally according to the chosen curve.
3. **Paused** *(optional)* — The sender pauses the stream; vesting stops and paused time is excluded from calculations.
4. **Withdraw** — The receiver withdraws the unlocked balance at any time.
5. **Closed** — The stream ends (completed or cancelled early by the sender).

---

## 3. Mathematical Engine

### 3.1 Linear Vesting (Default)

The standard streaming formula provides proportional unlocking:

```
unlocked_amount = total_amount × (elapsed_time / total_duration)
```

**Example**: $1,000 stream over 100 days

- Day 25: $250 unlocked (25% complete)
- Day 50: $500 unlocked (50% complete)
- Day 100: $1,000 unlocked (100% complete)

### 3.2 Exponential Curve (Optional)

Accelerated vesting using quadratic growth:

```
unlocked_amount = total_amount × (elapsed_time² / total_duration²)
```

**Example**: Same $1,000 stream with exponential curve

- Day 25: $62.50 unlocked (6.25% complete)
- Day 50: $250 unlocked (25% complete)
- Day 75: $562.50 unlocked (56.25% complete)
- Day 100: $1,000 unlocked (100% complete)

### 3.3 Cliff Support

Nothing unlocks before the cliff time, then normal vesting begins:

```rust
if current_time < cliff_time {
    return 0;  // Nothing unlocked yet
}
// Otherwise, calculate from cliff_time to end_time
```

### 3.4 Precision & Safety

- **Integer Math**: Uses `i128` for all calculations — no floating point.
- **Floor Division**: Always rounds down to favor contract solvency.
- **Overflow Protection**: Checked multiplication prevents arithmetic overflow.
- **Dust Prevention**: Final withdrawals use the exact remaining balance.

---

## 4. Security Features

### 4.1 Re-entrancy Protection

A mutex pattern prevents re-entrant calls during contract operations:

```rust
// Mutex pattern prevents re-entrant calls
let lock_key = symbol_short!("LOCK");
env.storage().temporary().set(&lock_key, &true);
// ... perform operations ...
env.storage().temporary().remove(&lock_key);
```

### 4.2 Role-Based Access Control (RBAC)

Three distinct roles with granular permissions:

| Role | Permissions |
|------|-------------|
| **Admin** | Grant/revoke roles, upgrade contract, all other permissions |
| **Pauser** | Pause/unpause contract operations (emergency stop) |
| **TreasuryManager** | Update protocol fees, change treasury address |

### 4.3 OFAC Compliance

Maintains a restricted address list to prevent streams to sanctioned addresses:

```rust
pub fn restrict_address(env: Env, admin: Address, target: Address)
pub fn unrestrict_address(env: Env, admin: Address, target: Address)
```

### 4.4 Soulbound Streams

Identity-locked streams that cannot be transferred:

```rust
Stream {
    is_soulbound: true,  // Set once at creation, immutable
    receiver: verified_address,  // Cannot be changed
    // ... other fields
}
```

### 4.5 Pause/Resume Mechanism

Senders can pause and resume streams using the `StreamState` enum (`Active`, `Paused`, `Closed`):

```rust
// Pause a stream - stops vesting
pub fn pause_stream(env: Env, stream_id: u64, caller: Address) -> Result<(), Error>

// Resume a paused stream - restores vesting with adjusted duration
pub fn resume_stream(env: Env, stream_id: u64, caller: Address) -> Result<(), Error>

// Paused duration is subtracted from calculations
effective_elapsed = current_time - start_time - total_paused_duration;
```

---

## 5. Using the Protocol

### As a Sender

1. Ensure you hold the token and have approved the contract.
2. Create a stream specifying receiver, token, total amount, start/end times, and curve type.
3. Monitor the stream; pause or cancel it if needed.

### As a Receiver

1. Query your streams with `get_user_streams`.
2. Check the unlocked amount with `get_withdrawable_amount`.
3. Withdraw your earned tokens at any time.

### Error Handling

Common errors you may encounter (full list in the API Reference):

| Error | Meaning |
|-------|---------|
| `InvalidTimeRange` | `start_time >= end_time` |
| `InvalidAmount` | amount <= 0 |
| `StreamNotFound` | Invalid `stream_id` |
| `Unauthorized` | Missing permissions |
| `StreamPaused` | Cannot withdraw while paused |
| `StreamIsSoulbound` | Transfer not allowed |
| `AddressRestricted` | OFAC compliance violation |

---

## 6. Next Steps

- Developers: read the [Integration Guide](./INTEGRATION_GUIDE.md) to build, test, and deploy the contracts.
- Integrators: read the [API Reference](./API_REFERENCE.md) for the complete function catalog.

---

*Built with ❤️ for the Stellar ecosystem.*
