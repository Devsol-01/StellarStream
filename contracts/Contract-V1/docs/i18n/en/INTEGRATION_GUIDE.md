# StellarStream Integration Guide

**Languages:** [English](./INTEGRATION_GUIDE.md) · [Español](../es/INTEGRATION_GUIDE.md) · [中文](../zh/INTEGRATION_GUIDE.md) · [日本語](../ja/INTEGRATION_GUIDE.md)

> This is the English (source) version of the StellarStream Integration Guide. Translations are maintained in the language folders of this directory. If you find a discrepancy, the English version is authoritative.

---

## 1. Prerequisites

- Rust 1.70+
- Soroban CLI
- Stellar SDK
- A funded Stellar account for testnet deployments

---

## 2. Building the Contract

```bash
cd contracts/
cargo build --target wasm32-unknown-unknown --release
```

The optimized WASM artifact is written to `target/wasm32-unknown-unknown/release/`.

---

## 3. Running Tests

```bash
# Run all tests (40+ test cases)
cargo test

# Run specific test modules
cargo test rbac_test
cargo test soulbound_test
cargo test migration_test

# Run with output
cargo test -- --nocapture

# Run benchmarks
cargo test bench_ --release
```

### Test Structure

```
src/
├── test.rs           # Core functionality tests (20+ tests)
├── rbac_test.rs      # Role-based access control (15+ tests)
├── soulbound_test.rs # Soulbound stream tests (8+ tests)
├── migration_test.rs # Schema migration tests (15+ tests)
├── upgrade_test.rs   # Contract upgrade tests (5+ tests)
├── pause_resume_test.rs # Pause/resume tests (8+ tests)
├── bench_test.rs     # Performance benchmarks (9+ tests)
```

---

## 4. Deploying to Testnet

```bash
# Build optimized WASM
stellar contract build

# Deploy to Futurenet
stellar contract deploy \
  --wasm target/wasm32-unknown-unknown/release/stellarstream_contracts.wasm \
  --source alice \
  --network futurenet

# Initialize contract
stellar contract invoke \
  --id <CONTRACT_ID> \
  --source alice \
  --network futurenet \
  -- initialize \
  --admin <ADMIN_ADDRESS>
```

---

## 5. Advanced Features

### 5.1 Interest Distribution

Streams can earn yield through vault integration:

```rust
pub struct Stream {
    pub interest_strategy: u32,     // Bitfield for distribution
    pub vault_address: Option<Address>, // Yield-bearing vault
    // ...
}

// Interest distribution strategies
const INTEREST_TO_SENDER: u32 = 0b001;     // All to sender
const INTEREST_TO_RECEIVER: u32 = 0b010;   // All to receiver
const INTEREST_TO_PROTOCOL: u32 = 0b100;   // All to protocol
const INTEREST_SPLIT_ALL: u32 = 0b111;     // 33/33/33 split
```

### 5.2 USD Pegging

Oracle-based USD amount conversion:

```rust
pub struct UsdPegConfig {
    pub usd_amount: i128,        // USD amount (7 decimals)
    pub min_price: i128,         // Slippage protection
    pub max_price: i128,         // Slippage protection
    pub oracle: PriceOracle,     // Price feed
}
```

### 5.3 Milestone Vesting

Custom unlock schedules:

```rust
pub struct Milestone {
    pub timestamp: u64,    // When to unlock
    pub percentage: u32,   // Percentage to unlock (basis points)
}

// Example: 25% at 3 months, 75% at 6 months
let milestones = vec![
    Milestone { timestamp: start + 90_days, percentage: 2500 },
    Milestone { timestamp: start + 180_days, percentage: 7500 },
];
```

### 5.4 Flash Loans

Temporary liquidity for arbitrage:

```rust
pub fn flash_loan(
    env: Env,
    borrower: Address,
    token: Address,
    amount: i128,
    callback_data: BytesN<32>,
) -> Result<(), Error>
```

---

## 6. Migration & Upgrades

### Contract Upgradability

The contract supports WASM upgrades through admin functions:

```rust
pub fn upgrade(env: Env, admin: Address, new_wasm_hash: BytesN<32>)
```

### Data Migration Framework

Automatic migration system for storage schema changes:

```rust
pub fn migrate(env: Env, admin: Address, target_version: u32)
pub fn migrate_single_stream(env: Env, admin: Address, stream_id: u64)
```

### Version Management

```rust
// Check current version
pub fn get_version(env: Env) -> u32

// Migration preserves all data
// - Stream balances remain accurate
// - Withdrawn amounts preserved
// - User permissions maintained
```

---

## 7. Production Checklist

### Pre-Deployment

- [ ] All tests passing (`cargo test`)
- [ ] Security audit completed
- [ ] Gas optimization verified
- [ ] Documentation updated
- [ ] Admin keys secured

### Post-Deployment

- [ ] Contract initialized with correct admin
- [ ] Role assignments configured
- [ ] Fee parameters set
- [ ] Treasury address configured
- [ ] Monitoring systems active

### Ongoing Maintenance

- [ ] Regular security reviews
- [ ] Performance monitoring
- [ ] User feedback integration
- [ ] Feature enhancement planning
- [ ] Compliance updates

---

## 8. Support

- Community: GitHub Issues and Discussions
- Real-time support: Discord
- Security issues: security@stellarstream.io

---

*Built with ❤️ for the Stellar ecosystem.*
