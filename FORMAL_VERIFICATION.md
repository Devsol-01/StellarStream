# Formal Verification — StellarStream Contracts

**Issue #1387** · Type: Quality, Security · Priority: High

This document describes the formal verification framework for StellarStream's
critical smart contracts. Formal specs are expressed as pure Rust predicates,
exercised by property-based (fuzzing) and unit test runners built directly into
each contract crate — no external solver required.

---
    






## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Contracts Covered](#contracts-covered)
  - [splitter-v3](#splitter-v3)
  - [Contract-V2](#contract-v2)
  - [Escrow](#escrow)
- [Running Verification Locally](#running-verification-locally)
- [CI / CD Integration](#ci--cd-integration)
- [Spec Reference](#spec-reference)
  - [splitter-v3 Specs](#splitter-v3-specs)
  - [Contract-V2 Specs](#contract-v2-specs)
  - [Escrow Specs](#escrow-specs)
- [Extending the Framework](#extending-the-framework)

---

## Overview

Formal verification in this project takes the form of **property-based testing
backed by mathematical invariants**. Each spec is a predicate function that
must return `true` for all valid inputs. The verifier runs tens of thousands
of deterministically generated random cases to find violations.

The approach is intentionally lightweight:

- **No external SMT solvers, no build-time toolchains beyond stable Rust.**
- Specs live next to the contract code they describe (`formal_spec.rs`).
- The runner (`verify.rs`) is a standard `#[cfg(test)]` module — CI runs it
  with `cargo test`.
- The `formal-verification` feature flag exposes spec modules for external
  tooling or future integration with model checkers such as Kani or MIRAI.

---

## Architecture

```
contracts/
├── Contract-V2/
│   └── src/
│       ├── formal_spec.rs   ← Spec predicates (SPY-*, SBC-*, SST-*, SAC-*, SEM-*)
│       └── verify.rs        ← Property-based runner (fuzz + unit tests)
├── splitter-v3/
│   └── src/
│       ├── formal_spec.rs   ← Spec predicates (PAY-*, BAL-*, STA-*, ACC-*, EMG-*)
│       └── verify.rs        ← Property-based runner
└── escrow/
    └── src/
        ├── formal_spec.rs   ← Spec predicates (EPY-*, EBL-*, EST-*, EAC-*, EEM-*)
        └── verify.rs        ← Property-based runner
```

Each `formal_spec.rs` module contains:

1. **Domain types** — pure Rust mirrors of the on-chain types (no `soroban_sdk`
   dependency, so they run in any test environment).
2. **Spec functions** — one function per spec ID, returning `bool`. Each
   function has a formal statement in its doc comment.
3. **Composite checker** — `check_all_*_specs()` calls every applicable spec
   for a given snapshot and returns a list of violated spec names.

Each `verify.rs` module contains:

1. **Fuzz tests** — `#[test]` functions that simulate 10,000–20,000 random
   inputs and assert all relevant specs pass on every iteration.
2. **Unit tests** — targeted tests for boundary conditions, edge cases, and
   boolean control-flow specs that are not naturally exercised by fuzz alone.
3. **Coverage report** — a `print_spec_coverage_report` test that prints a
   table of every spec and its verification method to the CI log.

---

## Contracts Covered

### splitter-v3

Soroban contract for one-time bulk token splits with multi-sig admin proposals
and circuit-breaker pause functionality.

**File:** `contracts/splitter-v3/src/formal_spec.rs`

| Group | Spec IDs | Coverage |
|-------|----------|----------|
| Payment logic | PAY-1 … PAY-5 | Fuzz 20k + unit |
| Balance conservation | BAL-1 … BAL-6 | Fuzz 20k |
| State transitions | STA-1 … STA-4 | Unit |
| Access control | ACC-1 … ACC-5 | Unit |
| Emergency / pause | EMG-1 … EMG-4 | Unit + fuzz 1k |

Total specs: **23** | Total verified iterations: **~21,000**

---

### Contract-V2

Soroban streaming payment contract with per-second flow rates, batch splits,
vault integration, DEX swap streaming, and compliance oracle support.

**File:** `contracts/Contract-V2/src/formal_spec.rs`

| Group | Spec IDs | Coverage |
|-------|----------|----------|
| Stream payment logic | SPY-1 … SPY-6 | Fuzz 10k–20k |
| Balance calculations | SBC-1 … SBC-7 | Fuzz 10k–20k + unit |
| State transitions | SST-1 … SST-5 | Unit |
| Access control | SAC-1 … SAC-6 | Unit + fuzz 1k |
| Emergency / pause | SEM-1 … SEM-4 | Unit + fuzz 1k |

Total specs: **28** | Total verified iterations: **~52,000**

---

### Escrow

Soroban escrow contract supporting time-lock, multi-sig, and milestone release
conditions, with arbiter-based dispute resolution.

**File:** `contracts/escrow/src/formal_spec.rs`

| Group | Spec IDs | Coverage |
|-------|----------|----------|
| Payment custody | EPY-1 … EPY-5 | Fuzz 20k + unit |
| Balance conservation | EBL-1 … EBL-4 | Fuzz 20k + unit |
| State machine | EST-1 … EST-6 | Unit + fuzz 10k |
| Access control | EAC-1 … EAC-6 | Unit |
| Emergency / dispute | EEM-1 … EEM-5 | Unit + fuzz 10k |

Total specs: **26** | Total verified iterations: **~61,000**

---

## Running Verification Locally

### Organization Management Integration

The Organization Management feature (v1.0.0) includes formal verification patterns for multi-tenancy invariants and RBAC enforcement through property-based testing using fast-check.

### All contracts (recommended)

```bash
# From the repo root
for contract in Contract-V2 splitter-v3 escrow; do
  echo "=== Verifying $contract ==="
  cd contracts/$contract
  cargo test formal_verification -- --nocapture
  cd ../..
done
```

### Single contract

```bash
cd contracts/Contract-V2
cargo test formal_verification -- --nocapture
```

### With the formal-verification feature (exposes spec modules externally)

```bash
cd contracts/splitter-v3
cargo build --features formal-verification
```

### Expected output (passing)

```
running 7 tests
test formal_verification::fuzz_payment_and_balance_specs ... ok
test formal_verification::unit_pay4_minimum_payment ... ok
test formal_verification::unit_state_transitions ... ok
test formal_verification::unit_access_control ... ok
test formal_verification::unit_emergency_specs ... ok
test formal_verification::unit_edge_cases ... ok
test formal_verification::print_spec_coverage_report ... ok

=== splitter-v3 Formal Verification Coverage Report ===
  PAY-1  non_negative           [fuzz 20k]
  PAY-2  no_overpayment         [fuzz 20k]
  ...
  EMG-4  emergency_conservation  [fuzz 1k]
=======================================================

✓ splitter-v3: 20000 fuzz iterations — all PAY/BAL specs passed
```

---

## CI / CD Integration

The formal verification step is defined in
`.github/workflows/contracts-ci.yml` as the `formal-verification` job.

```
contracts-check (matrix: all 4 contracts)
       ↓  needs: contracts-check
formal-verification (matrix: Contract-V2, splitter-v3, escrow)
```

**Job behaviour:**

| Condition | Result |
|-----------|--------|
| All specs pass | ✅ Job green, coverage report written to step summary |
| Any spec violated | ❌ Job red, `VIOLATION` line printed with iteration details |
| Test binary crashes | ❌ Job red, exit code propagated |

**Artifacts:** Each run uploads a `formal-verification-report-<contract>` artifact
(retained 30 days) containing the full test output including coverage table and
any violation details.

**Step summary:** A Markdown table and collapsible coverage report is written to
the GitHub Actions step summary for each contract.

---

## Spec Reference

### splitter-v3 Specs

#### Payment Logic (PAY-*)

| ID | Formal Statement |
|----|-----------------|
| PAY-1 | `∀ alloc: alloc.received ≥ 0` |
| PAY-2 | `∀ alloc: alloc.received ≤ ceil(D × share_bps / 10_000)` |
| PAY-3 | `∀ alloc: share_bps > 0 → received ≥ 1` |
| PAY-4 | `∀ alloc: share_bps > 0 → received ≥ MIN_PAYMENT_STROOPS` |
| PAY-5 | `∀ alloc: share_bps == 0 → received == 0` |

#### Balance Conservation (BAL-*)

| ID | Formal Statement |
|----|-----------------|
| BAL-1 | `total_sent == Σ(received) + fee_collected` |
| BAL-2 | `Σ(share_bps) == 10_000` |
| BAL-3 | `fee_bps ≤ 500` |
| BAL-4 | `|fee_collected − (total_sent × fee_bps / 10_000)| ≤ 1` |
| BAL-5 | `Σ(received) + fee_collected ≤ total_sent` |
| BAL-6 | `total_sent − fee_collected == Σ(received)` (no locked dust) |

#### State Transitions (STA-*)

| ID | Formal Statement |
|----|-----------------|
| STA-1 | `state_before == Executed → state_after ≠ Pending` |
| STA-2 | `state_before == Cancelled → state_after ≠ Executed` |
| STA-3 | `state_after == Executed → state_before == Pending` |
| STA-4 | `action == Execute → state_before ≠ state_after` |

#### Access Control (ACC-*)

| ID | Formal Statement |
|----|-----------------|
| ACC-1 | `admin_fn_called → caller == admin` |
| ACC-2 | `proposal.executed → approvals ≥ threshold` |
| ACC-3 | `approval_count == unique_approver_count` |
| ACC-4 | `cancel_called → caller == split.sender` |
| ACC-5 | `council_action → valid_sigs ≥ required_threshold` |

#### Emergency (EMG-*)

| ID | Formal Statement |
|----|-----------------|
| EMG-1 | `state == Paused → split_execution_rejected` |
| EMG-2 | `Active → Paused transition → valid_admin_proposal_consumed` |
| EMG-4 | `splits_during_pause == 0 → balance_before == balance_after` |

---

### Contract-V2 Specs

#### Stream Payment Logic (SPY-*)

| ID | Formal Statement |
|----|-----------------|
| SPY-1 | `claimable(T) = flow_rate × (T − start_time)  ±1` |
| SPY-2 | `claimable(T) ≤ deposit_amount` |
| SPY-3 | `claimed_after ≥ claimed_before` |
| SPY-4 | `0 < flow_rate ≤ MAX_FLOW_RATE` |
| SPY-5 | `0 < deposit ≤ MAX_STREAM_AMOUNT` |
| SPY-6 | `claim_amount ≤ accrued_at_claim_time` |

#### Balance Calculations (SBC-*)

| ID | Formal Statement |
|----|-----------------|
| SBC-1 | `deposit == claimed + returned + fee` (terminal) |
| SBC-2 | `claimed + returned + fee ≤ deposit` |
| SBC-3 | `fee_collected ≤ deposit × MAX_FEE_BPS / 10_000` |
| SBC-4 | `|fee_collected − (deposit × fee_bps / 10_000)| ≤ 1` |
| SBC-5 | `total_allocated == Σ(claimed) + fee` (batch) |
| SBC-6 | `Σ(share_bps) == 10_000` (batch) |
| SBC-7 | `flow_rate × duration ≤ i128::MAX` (overflow guard) |

#### State Transitions (SST-*)

| ID | Formal Statement |
|----|-----------------|
| SST-1 | `Completed → Completed` (terminal) |
| SST-2 | `Cancelled → Cancelled` (terminal) |
| SST-3 | `claim_executed → state == Active` |
| SST-4 | `end_time > 0 → end_time > start_time` |
| SST-5 | Only valid transitions: `Active→{Cancelled,Completed}`, `Paused→Active` |

#### Access Control (SAC-*)

| ID | Formal Statement |
|----|-----------------|
| SAC-1 | `cancel_called → caller == sender` |
| SAC-2 | `claim_called → caller == recipient` |
| SAC-3 | `admin_fn_called → caller == stored_admin` |
| SAC-4 | `multisig_executed → approvals ≥ threshold` |
| SAC-5 | `oracle_denied(X) → stream_rejected` |
| SAC-6 | `applied_fee_bps ≤ base_fee_bps` |

#### Emergency (SEM-*)

| ID | Formal Statement |
|----|-----------------|
| SEM-1 | `contract_paused → stream_create_rejected` |
| SEM-2 | `contract_paused → claim_rejected` |
| SEM-3 | `total_locked_before_pause == total_locked_after_pause` |
| SEM-4 | `terminated_before → terminated_after` |

---

### Escrow Specs

#### Payment Custody (EPY-*)

| ID | Formal Statement |
|----|-----------------|
| EPY-1 | `Released → released_amount == locked_amount` |
| EPY-2 | `Refunded → refunded_amount == locked_amount` |
| EPY-3 | `released > 0 → condition_satisfied` |
| EPY-4 | `locked_amount > 0` |
| EPY-5 | `released > 0 → refunded == 0`  and vice versa |

#### Balance Conservation (EBL-*)

| ID | Formal Statement |
|----|-----------------|
| EBL-1 | `locked == released + refunded` (terminal states) |
| EBL-2 | `released + refunded ≤ locked` |
| EBL-3 | `PendingFunding → released == 0 ∧ refunded == 0` |
| EBL-4 | `Cancelled ∧ !funded → released == 0 ∧ refunded == 0` |

#### State Machine (EST-*)

| ID | Formal Statement |
|----|-----------------|
| EST-1 | `Released → Released` (terminal) |
| EST-2 | `Refunded → Refunded` (terminal) |
| EST-3 | `Cancelled → Cancelled` (terminal) |
| EST-4 | Only valid transitions (see code) |
| EST-5 | `PendingFunding → Active → is_funded == true` |
| EST-6 | `TimeLock{T} ∧ now < T → release_rejected` |

#### Access Control (EAC-*)

| ID | Formal Statement |
|----|-----------------|
| EAC-1 | `refund_initiated → caller == depositor` |
| EAC-2 | `release_triggered → caller == recipient` |
| EAC-3 | `dispute_resolved → caller == arbiter ∧ has_arbiter` |
| EAC-4 | `dispute_raised → caller ∈ {depositor, recipient}` |
| EAC-5 | `multisig_executed → unique_approvals ≥ threshold` |
| EAC-6 | `unique_approvals == total_approvals` |

#### Emergency / Dispute (EEM-*)

| ID | Formal Statement |
|----|-----------------|
| EEM-1 | `expires_at > 0 ∧ now ≥ expires_at → refund_possible` |
| EEM-2 | `dispute_raised → state == Active` |
| EEM-3 | `dispute_resolved → resolution ∈ {Release, Refund}` |
| EEM-4 | `!has_arbiter ∧ Disputed → !resolved_by_contract` |
| EEM-5 | `admin_emergency → !released_to_recipient` |

---

## Extending the Framework

### Adding a new spec

1. Open `contracts/<contract>/src/formal_spec.rs`.
2. Add a new predicate function with the next available ID in the group:

   ```rust
   /// PAY-6: Description of the new property.
   ///
   /// Formal statement:
   ///   <mathematical expression>
   pub fn spec_pay_6_my_new_property(/* args */) -> bool {
       // pure predicate, no side effects
   }
   ```

3. Add the spec to `check_all_payment_specs()` (or the appropriate composite).
4. Add a test (fuzz or unit) in `verify.rs`.
5. Update the coverage table in `print_spec_coverage_report`.

### Integrating a model checker (future)

The `formal-verification` feature flag exposes `pub mod formal_spec` without
needing the `soroban_sdk` testutils. This makes the spec modules usable with:

- **Kani** (`cargo kani`) — bounds checking and proof harnesses
- **MIRAI** — abstract interpretation over MIR
- **Prusti** — Rust spec annotations with Z3 backend

To integrate, add the model checker as a dev-dependency gated on the feature
and write proof harnesses in a separate file (e.g., `kani_harness.rs`).
