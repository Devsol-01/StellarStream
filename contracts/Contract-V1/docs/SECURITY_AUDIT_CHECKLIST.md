# StellarStream V1 — Security Audit Checklist

A pre-deployment security gate for the StellarStream streaming contract
(`contracts/Contract-V1`). It is written for two audiences: **auditors** reviewing a
release, and **contributors** implementing V1 against a target they can check their work
against.

> **State note.** At the time of writing, `contracts/Contract-V1/src/lib.rs` is a genesis
> skeleton — `initialize` and the streaming entry points are `// TODO`. The items below are
> therefore phrased against the protocol's **specified design** (see the project README and
> the vesting formula reproduced under [Threat Model](#threat-model)) and the intended entry
> points `initialize`, `create_stream`, `withdraw`, `cancel`. Each item is a gate the
> implementation must pass **before mainnet deployment**. Treat any `TODO` still present as an
> automatic **FAIL** of the corresponding item.

## How to use this checklist

- Every item has an explicit **Pass** / **Fail** condition — mark the box only when *Pass* is
  objectively true in the code under review, not merely "looks fine."
- Items cite a **Ref** (file / function / design formula) so a reviewer can go straight to the
  relevant code, and a **Mitigation** describing the fix when the item fails.
- The document is versioned with the contract: when a new vulnerability class is found, add an
  item here in the same PR that fixes it.

---

## Threat model

**Assets at risk:** the ERC-esque token balances escrowed by the contract (SEP-41 tokens
deposited by senders), and the correctness of each receiver's claimable amount.

**Core invariant (the money invariant):** for any stream at any ledger time `t`,
`withdrawn + refunded + still_locked == deposited`, and
`unlocked(t) = deposited * (t - start) / (end - start)` clamped to `[0, deposited]`, with
`withdrawable(t) = unlocked(t) - withdrawn`. No sequence of calls (withdraw, cancel, re-entry,
overflow, rounding) may let total outflow exceed `deposited` or let a party claim funds that
belong to the counterparty.

**Actors & trust boundaries:**
| Actor | Can call | Must NOT be able to |
|---|---|---|
| Sender | `create_stream`, `cancel` (if allowed) | withdraw the receiver's earned funds; reclaim already-earned funds |
| Receiver | `withdraw`, `cancel` (if allowed) | withdraw more than `unlocked(t)`; claim the sender's unearned refund |
| Admin | `initialize`, upgrade | move user funds; silently change stream terms |
| Arbitrary caller | read/view | mutate any stream, or trigger any privileged path |

**Trust assumptions:** the Stellar ledger timestamp is monotonic and not attacker-controlled to
a meaningful degree; the SEP-41 token is well-behaved *unless* an item below says to defend
against a malicious token.

---

## 1. Access Control Review

- [ ] **Admin set exactly once.** `initialize` must reject re-initialization. Pass: a second
  `initialize` call returns `Error::AlreadyInitialized`. Fail: admin is overwritable. Ref:
  `initialize` / lib.rs. Mitigation: guard on `has(Admin)` before set.
- [ ] **Stream mutation is party-scoped.** Only the stream's sender/receiver (per role) can act
  on it. Pass: a third party calling `withdraw`/`cancel` on someone else's stream errors. Fail:
  any address can act. Ref: `withdraw`, `cancel`. Mitigation: load stream, compare caller to
  stored sender/receiver.
- [ ] **`create_stream` cannot spoof the sender.** The debited address must be the
  authenticated caller. Pass: sender is taken from `require_auth`-ed address, not a parameter.
  Fail: `from` is an unauthenticated arg. Ref: `create_stream`.
- [ ] **Cancel rights match configuration.** Whoever is configured as allowed-canceller (sender,
  receiver, or both) is enforced. Pass: a party not permitted to cancel is rejected. Fail:
  either party can always cancel. Ref: `cancel`.
- [ ] **No public setter for stream terms.** `start`, `end`, `deposited` are immutable after
  creation. Pass: no entry point mutates them. Fail: an update path exists. Ref: storage writes.
- [ ] **Admin cannot touch user funds.** No admin path transfers escrowed tokens or edits a
  stream. Pass: admin surface is limited to config/upgrade. Fail: admin can drain. Ref: all
  admin-gated fns.
- [ ] **View functions are read-only.** Getters never write storage or move tokens. Pass:
  `get_*` functions are side-effect free. Fail: a getter mutates. Ref: view fns.
- [ ] **Role confusion is impossible.** Sender and receiver are distinct and validated at
  creation. Pass: `sender != receiver` enforced (or explicitly allowed & safe). Fail:
  self-stream causes accounting ambiguity. Ref: `create_stream`.
- [ ] **Privileged constants are not caller-supplied.** Fee/admin addresses come from storage,
  not call args. Pass: no privileged address read from `request`. Fail: spoofable.

## 2. Authorization Checks (Soroban `require_auth`)

- [ ] **Every fund-moving entry point calls `require_auth`.** Pass: `create_stream`, `withdraw`,
  `cancel` each `require_auth` the acting party before any transfer. Fail: any is missing. Ref:
  lib.rs entry points. Mitigation: add `x.require_auth()` as the first effect.
- [ ] **Auth is on the correct address.** Withdraw authorizes the *receiver*; cancel authorizes
  the *canceller*; create authorizes the *sender*. Pass: each matches. Fail: wrong subject.
- [ ] **`require_auth` precedes state reads used for transfers.** Pass: auth cannot be bypassed
  by early return. Fail: transfer computed before auth. Ref: fn ordering.
- [ ] **No `require_auth_for_args` misuse.** If used, the args bound match what is executed.
  Pass: bound args == executed args. Fail: mismatch enables replay with different args.
- [ ] **Admin operations require admin auth.** Pass: `initialize`/upgrade `require_auth(admin)`.
  Fail: unauthenticated admin path.
- [ ] **Token transfers rely on contract-held auth, not user pre-approval assumptions.** Pass:
  `transfer`/`transfer_from` authorization model is explicit and correct. Fail: relies on
  implicit allowance. Ref: token calls.
- [ ] **Auth cannot be satisfied by the contract itself acting as the user.** Pass: no path
  where the contract forges user intent. Fail: contract-as-user.
- [ ] **Tests prove unauthorized callers panic.** Pass: a test invokes each fund path without
  mocking the required auth and asserts failure. Fail: no negative auth test. Ref: `mod test`.

## 3. Integer Overflow / Underflow

- [ ] **`overflow-checks` stays enabled for release.** Pass: `contracts/Contract-V1/Cargo.toml`
  keeps `[profile.release] overflow-checks = true`. Fail: removed/false. Ref:
  `Cargo.toml:28`. Note: with it on, an overflow **traps** — good for safety, bad if it turns a
  recoverable case into an abort, so still use checked math and return `Error`.
- [ ] **Vesting numerator uses checked/wide math.** `deposited * (t - start)` can exceed the
  type. Pass: computed with `checked_mul` (or `i128`/`u128` wide intermediate) returning
  `Error::Overflow`. Fail: plain `*`. Ref: `withdraw`/`unlocked`, formula
  `deposited*(t-start)/(end-start)`.
- [ ] **Division denominator can never be zero.** `end - start` must be `> 0`. Pass:
  `create_stream` rejects `end <= start`. Fail: div-by-zero trap possible. Ref: `create_stream`.
- [ ] **`t - start` underflow guarded.** For `t < start`, unlocked must be `0`, not a wrapped
  huge value. Pass: pre-start returns `0`. Fail: underflow. Ref: `unlocked`.
- [ ] **Clamp to `[0, deposited]`.** Rounding must never yield `unlocked > deposited`. Pass:
  result clamped. Fail: >deposited payable. Ref: `unlocked`.
- [ ] **`withdrawable = unlocked - withdrawn` cannot underflow.** Pass: `withdrawn <= unlocked`
  invariant holds; checked_sub. Fail: underflow after rounding. Ref: `withdraw`.
- [ ] **Refund math is checked.** `refund = deposited - unlocked(cancel_t)` uses checked_sub.
  Pass: no underflow. Fail: plain sub. Ref: `cancel`.
- [ ] **No silent truncation on casts.** `as usize`/`as u64` narrowing is bounds-checked. Pass:
  narrowing casts validated. Fail: unchecked `as`. Ref: any cast.
- [ ] **Amount and time types are wide enough.** Token amounts are `i128` (SEP-41), timestamps
  `u64`. Pass: types match SEP-41 / ledger. Fail: narrower types risk overflow. Ref: type defs.
- [ ] **Rounding direction favors the contract.** Integer division rounds *down* on payout so
  the contract never over-pays. Pass: floor division on withdrawable. Fail: rounds up. Ref:
  `unlocked`.

## 4. Re-entrancy Protection

- [ ] **Checks-Effects-Interactions ordering.** State (withdrawn, status) is updated *before* the
  SEP-41 `transfer` call. Pass: storage write precedes token call. Fail: transfer then update.
  Ref: `withdraw`, `cancel`.
- [ ] **No claimable state readable-as-unchanged during a token callback.** Pass: `withdrawn` is
  persisted before transfer so a re-entrant `withdraw` sees the new value. Fail: double-claim
  window. Ref: `withdraw`. Threat: malicious SEP-41 token calls back into `withdraw`.
- [ ] **Cancel is idempotent / single-shot.** Pass: a cancelled stream's status blocks a second
  cancel and any further withdraw. Fail: re-entrant cancel double-refunds. Ref: `cancel`.
- [ ] **No cross-function re-entrancy.** A token callback into a *different* entry point cannot
  violate the money invariant. Pass: all mutators update state first. Fail: e.g. withdraw during
  cancel. Ref: all fund paths.
- [ ] **Stream status machine is enforced.** `Active → Cancelled/Completed` transitions are
  one-way and checked on entry. Pass: terminal states reject mutation. Fail: revivable stream.
- [ ] **No reliance on token being non-reentrant.** Pass: safety holds even for a hostile token
  (defensive). Fail: assumes well-behaved token. Ref: threat model trust assumptions.

## 5. Storage Security

- [ ] **Correct storage durability per datum.** Stream data uses `persistent`; config/admin
  `instance`. Pass: durability matches lifetime. Fail: streams in `temporary` (can expire and
  lose funds accounting). Ref: storage keys.
- [ ] **TTL is bumped on access.** Persistent stream entries `extend_ttl` on read/write so an
  active stream cannot expire mid-life. Pass: TTL extended. Fail: archived stream strands funds.
  Ref: `withdraw`/getters.
- [ ] **Storage keys are collision-free & typed.** A `contracttype` enum key namespaces
  `Stream(id)`, `Admin`, etc. Pass: distinct typed keys. Fail: string/overlapping keys. Ref:
  `DataKey`.
- [ ] **Stream IDs are non-forgeable & unique.** Pass: IDs are sequential/derived, not
  caller-chosen in a way that overwrites an existing stream. Fail: `create_stream` can clobber
  an existing id. Ref: `create_stream`.
- [ ] **No unbounded growth in a single entry.** Per-stream data is fixed-size; no unbounded
  Vec/Map that inflates rent or gas. Pass: bounded. Fail: unbounded holder list etc. Ref: state.
- [ ] **Deleted/completed streams are cleaned up.** Fully-withdrawn or cancelled streams are
  removed or marked terminal to bound state. Pass: cleanup/terminal flag. Fail: leak. Ref:
  `withdraw`/`cancel`.
- [ ] **No sensitive data in events/logs.** Pass: events carry ids/amounts, not secrets. Fail:
  leaks. Ref: `env.events()`.
- [ ] **Read-before-write consistency.** Concurrent-looking updates (multiple withdraws) always
  re-read persisted `withdrawn`. Pass: no stale in-memory copy written back. Fail: lost update.
- [ ] **Instance-storage bump for the contract itself.** Pass: instance storage (admin/config)
  `extend_ttl` so the contract instance cannot be archived while streams are live. Fail: instance
  can expire. Ref: `initialize` / instance storage.
- [ ] **Migration-safe key encoding.** Pass: `DataKey` uses a `contracttype` enum (stable
  encoding), not ad-hoc tuples that change layout. Fail: fragile keys. Ref: `DataKey`.

## 6. Error Handling

- [ ] **All fallible paths return `Result<_, Error>`.** Pass: no `unwrap()`/`expect()`/`panic!`
  on caller-reachable input. Fail: any. Ref: whole file. Mitigation: replace with `ok_or(Error)`.
- [ ] **A dedicated `#[contracterror]` enum exists.** Pass: variants like `AlreadyInitialized`,
  `Unauthorized`, `Overflow`, `StreamNotFound`, `NothingToWithdraw`, `InvalidTimeRange`,
  `AlreadyCancelled`. Fail: stringly errors. Ref: error enum.
- [ ] **Error codes are stable.** Pass: `#[repr(u32)]` values are not reordered across releases.
  Fail: reordering breaks clients. Ref: error enum.
- [ ] **`unwrap_or` defaults are safe.** Pass: defaulting to `0`/empty cannot be exploited (e.g.
  missing balance → 0, not payout). Fail: unsafe default. Ref: storage reads.
- [ ] **Panics only for truly-unreachable invariants.** Pass: `panic_with_error!` used only for
  impossible states, documented. Fail: user input can panic. Ref: any panic.
- [ ] **Failure is atomic (no partial mutation).** Pass: an error path leaves no half-applied
  state (Soroban rolls back on panic; ensure `Err` returns don't pre-mutate). Fail: partial
  write persisted before an `Err`. Ref: mutators.
- [ ] **Descriptive, non-leaky messages.** Pass: errors identify the class without leaking
  internals. Fail: opaque or over-sharing.
- [ ] **Tests assert exact error variants.** Pass: negative tests use `try_*` and match the
  specific `Error`. Fail: only `should_panic`. Ref: `mod test`.

## 7. External Call Safety (SEP-41 token)

- [ ] **Token address is validated/pinned per stream.** Pass: the SEP-41 token is stored at
  creation and reused; not re-supplied per call. Fail: caller passes token to `withdraw`
  (asset-swap attack). Ref: `create_stream`/`withdraw`.
- [ ] **Return/interaction of `transfer` is handled.** Pass: transfer failure aborts the whole
  op (no state left claiming success). Fail: ignored failure. Ref: token calls.
- [ ] **Balance actually escrowed at creation.** Pass: `create_stream` pulls `deposited` into
  the contract before recording the stream. Fail: stream recorded without funds. Ref:
  `create_stream`.
- [ ] **No arbitrary external contract calls.** Pass: only the pinned SEP-41 token is invoked.
  Fail: caller-controlled contract invoked. Ref: cross-contract calls.
- [ ] **Reentrancy from token handled (see §4).** Pass: CEI holds around every `transfer`.
- [ ] **Fee-on-transfer / rebasing tokens considered.** Pass: either rejected or accounting uses
  actual received balance delta. Fail: assumes 1:1. Ref: `create_stream` deposit accounting.
- [ ] **Decimals not assumed.** Pass: no hard-coded 7-decimals math that breaks other tokens.
  Fail: assumed decimals. Ref: amount math.
- [ ] **No delegatecall-style trust.** Pass: contract never executes untrusted code paths. Fail:
  it does.

## 8. Upgrade Safety

- [ ] **Upgrade is admin-gated.** Pass: only admin can `update_current_contract_wasm`. Fail:
  anyone. Ref: upgrade fn.
- [ ] **Storage layout is upgrade-compatible.** Pass: `DataKey` variants are only appended,
  never reordered/removed. Fail: layout break corrupts existing streams. Ref: `DataKey`.
- [ ] **Upgrade cannot rug in-flight streams.** Pass: a new wasm preserves the money invariant
  for existing streams (documented migration). Fail: silent term change. Threat: malicious
  upgrade drains escrow.
- [ ] **Upgrade authority can be renounced/timelocked.** Pass: a path to reduce admin power
  (renounce or timelock) exists or is documented as out-of-scope with rationale. Fail: perpetual
  unilateral upgrade with no disclosure.
- [ ] **Version is tracked on-chain.** Pass: a `version` is readable to detect the deployed
  build. Fail: unversioned.
- [ ] **No constructor-only invariants lost on upgrade.** Pass: invariants re-checked post
  upgrade. Fail: assumed.

## 9. Economic Attacks

- [ ] **Dust/zero streams rejected.** Pass: `create_stream` rejects `deposited == 0` or
  zero-duration. Fail: griefing with junk streams. Ref: `create_stream`.
- [ ] **Rounding cannot be farmed.** Pass: many tiny withdrawals cannot extract more than
  `unlocked(t)` due to floor rounding + `withdrawn` tracking. Fail: rounding leak per call. Ref:
  `withdraw` math (see §3).
- [ ] **Cancel timing cannot double-pay.** Pass: at cancel, receiver gets `unlocked(t) -
  withdrawn` and sender gets the exact remainder; sum ≤ `deposited`. Fail: overlap. Ref:
  `cancel`.
- [ ] **Front-running cancel/withdraw is neutral.** Pass: ordering of a receiver withdraw vs a
  sender cancel in the same ledger cannot pay out more than earned. Fail: ordering exploit. Ref:
  `withdraw`+`cancel`.
- [ ] **Timestamp manipulation bounded.** Pass: reliance on `ledger().timestamp()` tolerates the
  ~few-second validator skew without value leakage. Fail: sensitive to small skew. Ref:
  `unlocked`.
- [ ] **No fee/precision path lets total outflow exceed deposit.** Pass: money invariant proven.
  Fail: any drain. Ref: whole flow.
- [ ] **Griefing via storage rent is bounded.** Pass: creating many streams costs the creator
  (they fund rent), not the protocol. Fail: protocol subsidizes spam.
- [ ] **DoS via a single huge stream handled.** Pass: no per-stream operation is unbounded. Fail:
  gas blow-up.

## 10. Known Vulnerabilities (Soroban / streaming class)

- [ ] **Uninitialized-contract calls rejected.** Pass: entry points fail cleanly before
  `initialize`. Fail: usable pre-init. Ref: entry points.
- [ ] **`require_auth` omission (the #1 Soroban bug).** Pass: audited per §2. Fail: any gap.
- [ ] **Unchecked arithmetic under `overflow-checks` (trap-as-DoS).** Pass: audited per §3. Fail:
  any plain op on caller input.
- [ ] **Storage expiration stranding funds.** Pass: audited per §5 TTL. Fail: no TTL bump.
- [ ] **Malicious SEP-41 token re-entrancy / asset swap.** Pass: audited per §4 & §7. Fail: gap.
- [ ] **Symbol length panic (`symbol_short!` > 9 chars).** Pass: all short symbols ≤ 9 chars or
  use `Symbol::new`. Fail: a >9-char `symbol_short!` traps at runtime. Ref: event topics.
- [ ] **Rounding/precision loss in linear vesting.** Pass: audited per §3 & §9. Fail: leak.
- [ ] **Replay across streams via shared nonce/id.** Pass: per-stream isolation. Fail: shared
  state.
- [ ] **Integer division truncation to zero for short streams.** Pass: very short/huge streams
  still honor the invariant. Fail: `unlocked` stuck at 0 or jumps.

## 11. Testing Coverage

- [ ] **`initialize` happy + double-init tested.** Pass: both. Fail: missing. Ref: `mod test`.
- [ ] **`create_stream` validation tested.** Pass: rejects `end<=start`, `deposited==0`,
  self-stream (if disallowed). Fail: gaps.
- [ ] **Vesting math boundary tests.** Pass: `t<start`→0, `t==start`→0, midpoint, `t>=end`→full,
  1-second and max-duration streams. Fail: only midcases. Ref: `unlocked`.
- [ ] **Overflow test near type max.** Pass: a stream with `deposited`/duration near the type
  boundary returns `Error::Overflow` (or is rejected) rather than trapping unexpectedly. Fail:
  none.
- [ ] **Multiple partial withdrawals sum correctly.** Pass: N withdrawals total exactly
  `unlocked(t_final)`. Fail: drift.
- [ ] **Unauthorized-caller negative tests (per §2).** Pass: each fund path. Fail: missing.
- [ ] **Cancel accounting test.** Pass: receiver earned + sender refund == deposited, at several
  cancel times. Fail: missing.
- [ ] **Re-entrancy test with a hostile mock token.** Pass: a mock SEP-41 that calls back cannot
  double-withdraw. Fail: none. Ref: §4.
- [ ] **Property/fuzz test for the money invariant.** Pass: randomized sequences preserve
  `withdrawn+refunded+locked==deposited`. Fail: none.
- [ ] **Tests run under the release profile / `overflow-checks`.** Pass: CI exercises the
  overflow-checked build. Fail: only dev profile. Ref: CI config + `Cargo.toml:28`.
- [ ] **Coverage threshold met.** Pass: all entry points and error variants exercised. Fail:
  dead paths.

## 12. Documentation Review

- [ ] **Every entry point documents auth + errors.** Pass: doc comments list who must auth and
  which `Error`s are returned. Fail: undocumented. Ref: `///` on each fn.
- [ ] **The money invariant is documented in-code.** Pass: the vesting formula and clamp are
  stated where implemented. Fail: implicit. Ref: `unlocked`.
- [ ] **README matches the implementation.** Pass: formula, cancel semantics, and supported
  tokens (SEP-41) agree with code. Fail: drift. Ref: README §vesting.
- [ ] **Cancellation rules are explicit.** Pass: who may cancel and the exact split are
  documented. Fail: ambiguous. Ref: `cancel` docs.
- [ ] **Upgrade/admin powers are disclosed.** Pass: docs state what admin can and cannot do.
  Fail: hidden trust. Ref: §8.
- [ ] **Assumptions are stated.** Pass: ledger-timestamp trust, token-behavior assumptions
  written down. Fail: implicit. Ref: this threat model.
- [ ] **This checklist is kept current.** Pass: new findings add items here in the same PR. Fail:
  stale. Ref: this file.
- [ ] **Deploy runbook exists.** Pass: a documented, repeatable deploy + post-deploy
  verification. Fail: ad-hoc.
- [ ] **Emitted events are documented.** Pass: each event topic/payload (stream created,
  withdrawn, cancelled) is documented for indexers. Fail: undocumented events. Ref: `env.events()`.

---

## References (security best practices)

- Soroban / Stellar smart-contract security guidance — <https://developers.stellar.org/docs/build/security-docs>
- Soroban authorization (`require_auth`) — <https://developers.stellar.org/docs/build/guides/auth>
- Soroban storage & state archival (TTL) — <https://developers.stellar.org/docs/build/guides/storage>
- SEP-41 Token Interface — <https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0041.md>
- OpenZeppelin Stellar contracts & audit practices — <https://github.com/OpenZeppelin/stellar-contracts>
- Smart Contract Weakness / general classes (SWC-style) — checks-effects-interactions, integer safety, access control.

> **Pass criteria for the release:** every box above is checked against the actual code, no
> `TODO` remains in a security-relevant path, and the money invariant is proven by tests under
> the `overflow-checks` release profile.
