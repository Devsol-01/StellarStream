# StellarStream Events Documentation

This document defines all contract events emitted by StellarStream for indexer integration (Mercury, Zephyr, etc.).

## Event Structure Standard

All events follow this convention:
- **`stream_id`** is always included as the primary identifier for filtering
- Events use Soroban's `env.events().publish()` with topic-data pairs

---

## Event Catalog

### 1. `create`

**Emitted when**: A new stream is created (single or batch)

**Topics**:
- `symbol_short!("create")` - Event type identifier
- `sender: Address` - The address creating the stream

**Data**:
- `stream_id: u64` - Unique identifier for the created stream

**Example**:
```rust
env.events().publish((symbol_short!("create"), sender), stream_id);
```

**Indexer Query**: Filter by `stream_id` or `sender` address to track stream creation history.

---

### 2. `withdraw`

**Emitted when**: A receiver withdraws unlocked funds from a stream

**Topics**:
- `symbol_short!("withdraw")` - Event type identifier
- `receiver: Address` - The address withdrawing funds

**Data**:
- `(stream_id: u64, withdrawable_amount: i128)` - Stream ID and amount withdrawn

**Example**:
```rust
env.events().publish(
    (symbol_short!("withdraw"), receiver),
    (stream_id, withdrawable_amount)
);
```

**Indexer Query**: Filter by `stream_id` to aggregate total withdrawals or by `receiver` to track user activity.

---

### 3. `cancel`

**Emitted when**: A sender cancels an active stream before completion

**Topics**:
- `symbol_short!("cancel")` - Event type identifier
- `stream_id: u64` - The stream being cancelled

**Data**:
- `sender: Address` - The address that initiated cancellation

**Example**:
```rust
env.events().publish((symbol_short!("cancel"), stream_id), stream.sender);
```

**Indexer Query**: Filter by `stream_id` to detect stream termination or by `sender` to track cancellation patterns.

---

## Indexer Integration Guide

### Filtering Streams
All events include `stream_id` in either topics or data, enabling efficient filtering:

```javascript
// Example: Get all events for stream #42
const events = await indexer.getEvents({
  contractId: STELLAR_STREAM_CONTRACT,
  topics: [["create", "withdraw", "cancel"], "*"],
  filters: { stream_id: 42 }
});
```

### Building User History
To construct a complete user history:

1. **Outgoing Streams**: Query `create` events where `sender = user_address`
2. **Incoming Streams**: Query `create` events, then filter by `receiver` from contract state
3. **Withdrawals**: Query `withdraw` events where `receiver = user_address`
4. **Cancellations**: Query `cancel` events where `sender = user_address`

### Event Ordering
Events are ordered by ledger sequence. Use `env.ledger().timestamp()` from ledger metadata to reconstruct timeline.

---

## Data Types Reference

| Type | Description |
|------|-------------|
| `u64` | Stream ID (unique, auto-incremented) |
| `Address` | Stellar address (sender/receiver) |
| `i128` | Token amount (Soroban native integer) |
| `symbol_short!()` | 9-character max symbol for event names |

---

## Notes for Backend/Frontend

- **Mercury/Zephyr**: Both support topic-based filtering. Index on `stream_id` for O(1) lookups.
- **Real-time Updates**: Subscribe to contract events via Soroban RPC's `getEvents` with pagination.
- **Historical Data**: Events are permanent on-chain. No need for off-chain backups unless caching for performance.
