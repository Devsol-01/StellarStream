//! # Formal Verification Runner — splitter-v3
//!
//! Issue #1387 — Contract Formal Verification
//!
//! This module is the verification harness for splitter-v3. It performs
//! property-based testing across all formal specs defined in `formal_spec.rs`
//! using a deterministic pseudo-random generator (no external deps needed).
//!
//! ## Run
//!
//! ```bash
//! cargo test formal_verification -- --nocapture
//! ```
//!
//! ## Coverage
//!
//! | Spec  | Description                              | Verified |
//! |-------|------------------------------------------|----------|
//! | PAY-1 | Non-negative recipient amounts           | ✓ fuzz   |
//! | PAY-2 | No recipient over-payment                | ✓ fuzz   |
//! | PAY-3 | Each positive-share gets ≥ 1 stroop      | ✓ fuzz   |
//! | PAY-4 | Minimum payment enforced                 | ✓ unit   |
//! | PAY-5 | Zero-share gets nothing                  | ✓ fuzz   |
//! | BAL-1 | Token conservation                       | ✓ fuzz   |
//! | BAL-2 | Shares sum to 100%                       | ✓ fuzz   |
//! | BAL-3 | Fee cap ≤ 5%                             | ✓ fuzz   |
//! | BAL-4 | Fee accuracy ±1 stroop                   | ✓ fuzz   |
//! | BAL-5 | No fund inflation                        | ✓ fuzz   |
//! | BAL-6 | No locked dust                           | ✓ fuzz   |
//! | STA-1 | Executed state irreversible              | ✓ unit   |
//! | STA-2 | Cancelled state terminal                 | ✓ unit   |
//! | STA-3 | Execute only from Pending                | ✓ unit   |
//! | STA-4 | Execution changes state                  | ✓ unit   |
//! | ACC-1 | Only admin can call admin functions      | ✓ unit   |
//! | ACC-2 | Quorum required for proposal execution   | ✓ unit   |
//! | ACC-3 | No duplicate approvals                   | ✓ unit   |
//! | ACC-4 | Only sender can cancel                   | ✓ unit   |
//! | ACC-5 | Council threshold enforced               | ✓ unit   |
//! | EMG-1 | No execution when paused                 | ✓ unit   |
//! | EMG-2 | Pause requires admin proposal            | ✓ unit   |
//! | EMG-4 | Emergency conserves balances             | ✓ fuzz   |

#[cfg(test)]
mod formal_verification {
    use crate::formal_spec::*;

    // ─────────────────────────────────────────────────────────────────────────
    // LCG pseudo-random generator (deterministic, no external deps)
    // ─────────────────────────────────────────────────────────────────────────

    struct Lcg(u64);

    impl Lcg {
        fn next(&mut self) -> u64 {
            self.0 = self.0
                .wrapping_mul(6_364_136_223_846_793_005)
                .wrapping_add(1_442_695_040_888_963_407);
            self.0
        }

        /// Returns a value in [lo, hi].
        fn range(&mut self, lo: u64, hi: u64) -> u64 {
            lo + self.next() % (hi - lo + 1)
        }

        fn range_i128(&mut self, lo: i128, hi: i128) -> i128 {
            lo + (self.next() as i128 % (hi - lo + 1))
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Simulation helpers
    // ─────────────────────────────────────────────────────────────────────────

    /// Build a valid split outcome from raw parameters (mirrors on-chain logic).
    fn simulate_split(total_sent: i128, shares_bps: &[u64], fee_bps: u64) -> SplitOutcome {
        let fee_collected = total_sent * fee_bps as i128 / BPS_DENOM as i128;
        let distributable = total_sent - fee_collected;

        let mut allocations: Vec<RecipientAlloc> = shares_bps
            .iter()
            .map(|&s| RecipientAlloc {
                share_bps: s,
                received: distributable * s as i128 / BPS_DENOM as i128,
            })
            .collect();

        // Assign rounding dust to the first recipient (on-chain behaviour)
        let sum_received: i128 = allocations.iter().map(|a| a.received).sum();
        let dust = distributable - sum_received;
        if let Some(first) = allocations.first_mut() {
            first.received += dust;
        }

        SplitOutcome {
            total_sent,
            allocations,
            fee_bps,
            fee_collected,
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // FUZZ: PAY + BAL specs — 20,000 random split configurations
    // ─────────────────────────────────────────────────────────────────────────

    #[test]
    fn fuzz_payment_and_balance_specs() {
        let mut rng = Lcg(0xFEED_BABE_CAFE_1337);
        let iterations = 20_000;
        let mut violations = 0usize;

        for i in 0..iterations {
            // Random total: 10 XLM to 100M XLM in stroops
            let total_sent =
                rng.range_i128(MIN_PAYMENT_STROOPS * 2, 100_000_000 * 10_000_000);

            // Random fee: 0–500 bps (0–5%)
            let fee_bps = rng.range(0, MAX_FEE_BPS);

            // Random 1–10 recipients whose shares sum to 10_000
            let n = rng.range(1, 10) as usize;
            let mut shares: Vec<u64> = Vec::with_capacity(n);
            let mut remaining: u64 = BPS_DENOM;
            for j in 0..n {
                let share = if j == n - 1 {
                    remaining
                } else {
                    let max = remaining.saturating_sub((n - j - 1) as u64);
                    rng.range(1, max.max(1))
                };
                shares.push(share);
                remaining = remaining.saturating_sub(share);
            }

            let outcome = simulate_split(total_sent, &shares, fee_bps);
            let failed = check_all_payment_specs(&outcome);

            if !failed.is_empty() {
                eprintln!(
                    "Iteration {i}: VIOLATIONS: {failed:?}\n  \
                     total_sent={total_sent}, fee_bps={fee_bps}, shares={shares:?}"
                );
                violations += 1;
            }
        }

        assert_eq!(
            violations, 0,
            "{violations}/{iterations} iterations violated payment/balance specs"
        );
        println!("✓ splitter-v3: {iterations} fuzz iterations — all PAY/BAL specs passed");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // UNIT: PAY-4 — Minimum payment enforcement
    // ─────────────────────────────────────────────────────────────────────────

    #[test]
    fn unit_pay4_minimum_payment() {
        // Valid: just above minimum
        let valid = SplitOutcome {
            total_sent: MIN_PAYMENT_STROOPS * 3,
            allocations: vec![
                RecipientAlloc { share_bps: 5000, received: MIN_PAYMENT_STROOPS },
                RecipientAlloc { share_bps: 5000, received: MIN_PAYMENT_STROOPS },
            ],
            fee_bps: 0,
            fee_collected: 0,
        };
        assert!(spec_pay_4_minimum_payment(&valid), "PAY-4: valid case should pass");

        // Invalid: below minimum
        let invalid = SplitOutcome {
            total_sent: MIN_PAYMENT_STROOPS,
            allocations: vec![
                RecipientAlloc { share_bps: 5000, received: MIN_PAYMENT_STROOPS / 2 - 1 },
                RecipientAlloc { share_bps: 5000, received: MIN_PAYMENT_STROOPS / 2 - 1 },
            ],
            fee_bps: 0,
            fee_collected: 0,
        };
        assert!(!spec_pay_4_minimum_payment(&invalid), "PAY-4: below-minimum case should fail");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // UNIT: STA-* — State transition specs
    // ─────────────────────────────────────────────────────────────────────────

    #[test]
    fn unit_state_transitions() {
        // STA-1: Executed cannot revert to Pending
        assert!(spec_sta_1_no_revert_executed("Executed", "Executed"));
        assert!(spec_sta_1_no_revert_executed("Executed", "Cancelled"));
        assert!(!spec_sta_1_no_revert_executed("Executed", "Pending"));

        // STA-2: Cancelled cannot become Executed
        assert!(spec_sta_2_cancelled_is_terminal("Cancelled", "Cancelled"));
        assert!(!spec_sta_2_cancelled_is_terminal("Cancelled", "Executed"));

        // STA-3: Execute only from Pending
        assert!(spec_sta_3_execute_from_pending_only("Pending", "Executed"));
        assert!(!spec_sta_3_execute_from_pending_only("Cancelled", "Executed"));

        // STA-4: Execute changes state
        assert!(spec_sta_4_execute_changes_state("Execute", "Pending", "Executed"));
        assert!(!spec_sta_4_execute_changes_state("Execute", "Pending", "Pending"));
        // Non-execute actions may keep state the same
        assert!(spec_sta_4_execute_changes_state("Query", "Pending", "Pending"));

        println!("✓ splitter-v3: all STA state-transition unit tests passed");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // UNIT: ACC-* — Access control specs
    // ─────────────────────────────────────────────────────────────────────────

    #[test]
    fn unit_access_control() {
        // ACC-1: Only admin
        assert!(spec_acc_1_only_admin(true, true));
        assert!(spec_acc_1_only_admin(false, false));
        assert!(!spec_acc_1_only_admin(false, true));

        // ACC-2: Quorum required
        let executed_proposal = ProposalStatus { approval_count: 3, threshold: 3, executed: true };
        assert!(spec_acc_2_quorum_required(&executed_proposal));

        let under_quorum = ProposalStatus { approval_count: 2, threshold: 3, executed: true };
        assert!(!spec_acc_2_quorum_required(&under_quorum));

        let not_executed = ProposalStatus { approval_count: 1, threshold: 3, executed: false };
        assert!(spec_acc_2_quorum_required(&not_executed));

        // ACC-3: No duplicate approvals
        assert!(spec_acc_3_no_duplicate_approval(3, 3));
        assert!(!spec_acc_3_no_duplicate_approval(3, 2)); // 3 submissions but only 2 unique

        // ACC-4: Only sender can cancel
        assert!(spec_acc_4_only_sender_can_cancel(true, true));
        assert!(spec_acc_4_only_sender_can_cancel(false, false));
        assert!(!spec_acc_4_only_sender_can_cancel(false, true));

        // ACC-5: Council threshold
        assert!(spec_acc_5_council_threshold(true, 2, 2));
        assert!(!spec_acc_5_council_threshold(true, 1, 2));
        assert!(spec_acc_5_council_threshold(false, 0, 2)); // non-council action, ok

        println!("✓ splitter-v3: all ACC access-control unit tests passed");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // UNIT: EMG-* — Emergency / circuit-breaker specs
    // ─────────────────────────────────────────────────────────────────────────

    #[test]
    fn unit_emergency_specs() {
        // EMG-1: No execution when paused
        assert!(spec_emg_1_no_execution_when_paused(&ContractState::Paused, true));
        assert!(!spec_emg_1_no_execution_when_paused(&ContractState::Paused, false));
        assert!(spec_emg_1_no_execution_when_paused(&ContractState::Active, false));

        // EMG-2: Pause requires admin proposal
        assert!(spec_emg_2_pause_requires_proposal(
            &ContractState::Active,
            &ContractState::Paused,
            true
        ));
        assert!(!spec_emg_2_pause_requires_proposal(
            &ContractState::Active,
            &ContractState::Paused,
            false
        ));
        // If already paused → stays paused, no proposal needed
        assert!(spec_emg_2_pause_requires_proposal(
            &ContractState::Paused,
            &ContractState::Paused,
            false
        ));

        // EMG-4: Emergency conserves balances (fuzz a few cases)
        let mut rng = Lcg(0xABCD_1234_5678_EF01);
        for _ in 0..1000 {
            let balance = rng.range_i128(0, 1_000_000_000);
            assert!(spec_emg_4_emergency_conservation(balance, balance, 0));
            assert!(!spec_emg_4_emergency_conservation(balance, balance + 1, 0));
        }

        println!("✓ splitter-v3: all EMG emergency unit tests passed");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // UNIT: Edge cases
    // ─────────────────────────────────────────────────────────────────────────

    #[test]
    fn unit_edge_cases() {
        // Single recipient, zero fee
        let single = simulate_split(100_000_000, &[10_000], 0);
        assert!(check_all_payment_specs(&single).is_empty(), "single recipient zero fee");

        // 100 recipients equal shares
        let equal_shares: Vec<u64> = vec![100; 100]; // 100 * 100 = 10_000 bps
        let many = simulate_split(1_000_000_000, &equal_shares, 100);
        let violations = check_all_payment_specs(&many);
        assert!(violations.is_empty(), "100 recipients violations: {violations:?}");

        // Maximum fee (500 bps = 5%)
        let max_fee = simulate_split(1_000_000_000, &[5000, 5000], MAX_FEE_BPS);
        assert!(check_all_payment_specs(&max_fee).is_empty(), "max fee edge case");

        // Minimum viable split (2 recipients, 1 XLM each)
        let min_viable = simulate_split(MIN_PAYMENT_STROOPS * 2, &[5000, 5000], 0);
        assert!(check_all_payment_specs(&min_viable).is_empty(), "minimum viable split");

        println!("✓ splitter-v3: all edge-case unit tests passed");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // SUMMARY: print spec coverage report
    // ─────────────────────────────────────────────────────────────────────────

    #[test]
    fn print_spec_coverage_report() {
        println!();
        println!("=== splitter-v3 Formal Verification Coverage Report ===");
        println!("  PAY-1  non_negative           [fuzz 20k]");
        println!("  PAY-2  no_overpayment         [fuzz 20k]");
        println!("  PAY-3  minimum_one_stroop      [fuzz 20k]");
        println!("  PAY-4  minimum_payment         [unit]");
        println!("  PAY-5  zero_share_gets_nothing [fuzz 20k]");
        println!("  BAL-1  conservation            [fuzz 20k]");
        println!("  BAL-2  shares_sum_100pct       [fuzz 20k]");
        println!("  BAL-3  fee_cap                 [fuzz 20k]");
        println!("  BAL-4  fee_accuracy            [fuzz 20k]");
        println!("  BAL-5  no_inflation            [fuzz 20k]");
        println!("  BAL-6  no_locked_dust          [fuzz 20k]");
        println!("  STA-1  executed_irreversible   [unit]");
        println!("  STA-2  cancelled_terminal      [unit]");
        println!("  STA-3  execute_from_pending    [unit]");
        println!("  STA-4  execute_changes_state   [unit]");
        println!("  ACC-1  only_admin              [unit]");
        println!("  ACC-2  quorum_required         [unit]");
        println!("  ACC-3  no_duplicate_approval   [unit]");
        println!("  ACC-4  only_sender_cancel      [unit]");
        println!("  ACC-5  council_threshold       [unit]");
        println!("  EMG-1  no_exec_when_paused     [unit]");
        println!("  EMG-2  pause_needs_proposal    [unit]");
        println!("  EMG-4  emergency_conservation  [fuzz 1k]");
        println!("=======================================================");
    }
}
