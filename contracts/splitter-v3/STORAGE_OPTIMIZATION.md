# Storage Access Pattern Optimization (#1484)

This document records the storage-access audit and the optimizations applied to
`splitter-v3` to reduce gas on the hot disbursement paths.

## Audit — before

The contract's read-mostly protocol configuration was spread across **seven**
independent instance-storage entries, each read individually on every call:

| `DataKey`          | Value                    | Read on hot paths |
|--------------------|--------------------------|-------------------|
| `Token`            | disbursement token addr  | `split`, `split_pull`, `schedule_split`, `execute_split`, `cancel_split`, `recovery_split`, `withdraw_affiliate` |
| `FeeBps`           | protocol fee             | `split`, `split_pull`, `execute_split` |
| `Treasury`         | fee destination          | `split`, `split_pull`, `execute_split` |
| `StrictMode`       | verification strictness  | `split` |
| `ContractState`    | Active / Paused          | every entry point (`_require_not_paused`) |
| `WhitelistOnly`    | whitelist gate flag      | `split_funds` |
| `IdentityValidator`| external validator addr  | `split_funds` |

Because each `env.storage().instance().get(...)` is a separate host call with a
**fixed per-entry cost** (on top of the per-byte cost), a single `split` call
issued **five** instance reads (`ContractState`, `StrictMode`, `Token`,
`FeeBps`, `Treasury`) and a `split_funds` call issued **three**
(`ContractState`, `WhitelistOnly`, `IdentityValidator`).

Additionally, the reentrancy guard `Locked` was stored in instance storage even
though it is only meaningful for the duration of a single transaction.

## Changes applied

### 1. Consolidated config into a single `ProtocolConfig` entry

A new `#[contracttype]` struct groups all seven fields:

```rust
pub struct ProtocolConfig {
    pub token: Address,
    pub fee_bps: u32,
    pub treasury: Address,
    pub strict_mode: bool,
    pub state: ContractState,
    pub whitelist_only: bool,
    pub identity_validator: Option<Address>,
}
```

It is stored under a single `DataKey::Config` instance entry. Helper accessors
(`_load_config`, `_require_config`, `_save_config`) read/write the whole struct
in one round-trip, and `_require_not_paused` now takes the already-loaded
config so a function issues exactly **one** instance read for all of its config
needs.

Read-count reduction per call:

| Function        | Instance config reads before | after |
|-----------------|------------------------------|-------|
| `split`         | 5                            | 1     |
| `split_funds`   | 3                            | 1     |
| `split_pull`    | 4                            | 1     |
| `execute_split` | 4                            | 1     |

All setters (`set_strict_mode`, `set_whitelist_only`, `set_identity_validator`,
`remove_identity_validator`, `set_contract_state`, `execute_proposal`) perform
a read-modify-write on the single entry, which keeps the struct the sole source
of truth.

### 2. Reentrancy lock moved to temporary storage

`_check_and_lock` / `_unlock` now use `env.storage().temporary()` for
`DataKey::Locked`. The lock is ephemeral (only observed within one transaction),
so temporary storage is the correct lifetime; it also removes a persistent
instance-storage entry that was otherwise re-written on every `split_funds`
call.

## Gas impact (analytical)

The saving comes from eliminating the fixed per-entry overhead of instance
reads: for the most common operation, `split`, config access drops from five
entries to one (an **80% reduction in config round-trips**), and `split_funds`
drops from three to one. Soroban meters each instance read with a fixed cost
independent of payload size, so removing four reads per `split` call is the
dominant structural saving. The lock now lives in cheaper, auto-expiring
temporary storage.

> Note: precise gas figures require running against the Soroban sandbox with a
> before/after benchmark (see `fuzz/` for the existing fuzz harnesses); the
> numbers above are the structural read-count deltas that the metering model
> charges per entry.

## Verification

- `cargo check` — clean.
- `cargo test` — **115 passed, 1 failed**. The single failure
  (`verify::formal_verification::fuzz_payment_and_balance_specs`) is a
  pre-existing bug in the #1387 formal-verification fuzz harness's own
  `simulate_split` (its "no overpayment" assertion is violated by its rounding),
  unrelated to this change. It fails identically on the pre-change baseline.

## Behavior

No functional change: every public function's inputs, outputs, authorization,
fee math and event emissions are unchanged. The only observable difference is
the on-chain storage layout (fresh deployment requires `initialize` to populate
the new `Config` entry).
