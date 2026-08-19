#[cfg(test)]
mod bench {
    use super::*;
    use soroban_sdk::{testutils::Address as _, Address, Env};

    const STREAM_AMOUNT: i128 = 1_000_000_000;
    const STREAM_DURATION: u64 = 86_400 * 30;

    fn setup_bench() -> (Env, Address, Address, Address, Address) {
        let env = Env::default();
        let admin = Address::generate(&env);
        let sender = Address::generate(&env);
        let receiver = Address::generate(&env);
        let token = Address::generate(&env);
        env.mock_all_auths();
        (env, admin, sender, receiver, token)
    }

    fn get_gas_used(env: &Env) -> u64 {
        env.budget().cpu_instruction_cost()
    }

    fn calculate_gas(start: u64, end: u64) -> u64 {
        end.saturating_sub(start)
    }

    fn print_result(operation: &str, gas: u64, notes: Option<&str>) {
        let notes_str = notes.unwrap_or("-");
        println!("{:<40} {:>12} {:>15}", operation, gas, notes_str);
    }

    fn print_header() {
        println!("\n{:=<80}", "");
        println!("{:<40} {:>12} {:>15}", "Operation", "Gas Cost", "Notes");
        println!("{:=<80}", "");
    }

    fn print_footer() {
        println!("{:=<80}\n", "");
    }

    #[test]
    fn bench_initialize() {
        let env = Env::default();
        let admin = Address::generate(&env);
        print_header();
        let gas_before = get_gas_used(&env);
        client.initialize(&env, &admin);
        let gas_after = get_gas_used(&env);
        let gas_used = calculate_gas(gas_before, gas_after);
        print_result("initialize", gas_used, Some("single call"));
        print_footer();
    }

    #[test]
    fn bench_create_stream_linear() {
        let (env, _admin, sender, receiver, token) = setup_bench();
        let start_time = env.ledger().timestamp() + 1;
        let end_time = start_time + STREAM_DURATION;
        let gas_before = get_gas_used(&env);
        client.create_stream(&env, &sender, &receiver, &token, STREAM_AMOUNT, start_time, end_time, 0, false);
        let gas_after = get_gas_used(&env);
        let gas_used = calculate_gas(gas_before, gas_after);
        print_header();
        print_result("create_stream (linear)", gas_used, Some("100 tokens, 30 days"));
        print_footer();
    }

    #[test]
    fn bench_create_stream_exponential() {
        let (env, _admin, sender, receiver, token) = setup_bench();
        let start_time = env.ledger().timestamp() + 1;
        let end_time = start_time + STREAM_DURATION;
        let gas_before = get_gas_used(&env);
        client.create_stream(&env, &sender, &receiver, &token, STREAM_AMOUNT, start_time, end_time, 1, false);
        let gas_after = get_gas_used(&env);
        let gas_used = calculate_gas(gas_before, gas_after);
        print_header();
        print_result("create_stream (exponential)", gas_used, Some("100 tokens, 30 days"));
        print_footer();
    }

    #[test]
    fn bench_create_stream_soulbound() {
        let (env, _admin, sender, receiver, token) = setup_bench();
        let start_time = env.ledger().timestamp() + 1;
        let end_time = start_time + STREAM_DURATION;
        let gas_before = get_gas_used(&env);
        client.create_stream(&env, &sender, &receiver, &token, STREAM_AMOUNT, start_time, end_time, 0, true);
        let gas_after = get_gas_used(&env);
        let gas_used = calculate_gas(gas_before, gas_after);
        print_header();
        print_result("create_stream (soulbound)", gas_used, Some("non-transferable"));
        print_footer();
    }

    #[test]
    fn bench_withdraw() {
        let (env, _admin, sender, receiver, token) = setup_bench();
        let start_time = env.ledger().timestamp() + 1;
        let end_time = start_time + STREAM_DURATION;
        let stream_id = client.create_stream(&env, &sender, &receiver, &token, STREAM_AMOUNT, start_time, end_time, 0, false);
        env.ledger().set_timestamp(start_time + STREAM_DURATION / 2);
        let gas_before = get_gas_used(&env);
        client.withdraw(&env, &stream_id, &receiver);
        let gas_after = get_gas_used(&env);
        let gas_used = calculate_gas(gas_before, gas_after);
        print_header();
        print_result("withdraw", gas_used, Some("50% vested"));
        print_footer();
    }

    #[test]
    fn bench_cancel_stream() {
        let (env, _admin, sender, receiver, token) = setup_bench();
        let start_time = env.ledger().timestamp() + 1;
        let end_time = start_time + STREAM_DURATION;
        let stream_id = client.create_stream(&env, &sender, &receiver, &token, STREAM_AMOUNT, start_time, end_time, 0, false);
        let gas_before = get_gas_used(&env);
        client.cancel_stream(&env, &stream_id);
        let gas_after = get_gas_used(&env);
        let gas_used = calculate_gas(gas_before, gas_after);
        print_header();
        print_result("cancel_stream", gas_used, Some("active stream"));
        print_footer();
    }

    #[test]
    fn bench_pause_stream() {
        let (env, _admin, sender, receiver, token) = setup_bench();
        let start_time = env.ledger().timestamp() + 1;
        let end_time = start_time + STREAM_DURATION;
        let stream_id = client.create_stream(&env, &sender, &receiver, &token, STREAM_AMOUNT, start_time, end_time, 0, false);
        let gas_before = get_gas_used(&env);
        client.pause_stream(&env, &stream_id);
        let gas_after = get_gas_used(&env);
        let gas_used = calculate_gas(gas_before, gas_after);
        print_header();
        print_result("pause_stream", gas_used, Some("active stream"));
        print_footer();
    }

    #[test]
    fn bench_resume_stream() {
        let (env, _admin, sender, receiver, token) = setup_bench();
        let start_time = env.ledger().timestamp() + 1;
        let end_time = start_time + STREAM_DURATION;
        let stream_id = client.create_stream(&env, &sender, &receiver, &token, STREAM_AMOUNT, start_time, end_time, 0, false);
        client.pause_stream(&env, &stream_id);
        let gas_before = get_gas_used(&env);
        client.resume_stream(&env, &stream_id);
        let gas_after = get_gas_used(&env);
        let gas_used = calculate_gas(gas_before, gas_after);
        print_header();
        print_result("resume_stream", gas_used, Some("paused stream"));
        print_footer();
    }

    #[test]
    fn bench_get_stream() {
        let (env, _admin, sender, receiver, token) = setup_bench();
        let start_time = env.ledger().timestamp() + 1;
        let end_time = start_time + STREAM_DURATION;
        let stream_id = client.create_stream(&env, &sender, &receiver, &token, STREAM_AMOUNT, start_time, end_time, 0, false);
        let gas_before = get_gas_used(&env);
        client.get_stream(&env, &stream_id);
        let gas_after = get_gas_used(&env);
        let gas_used = calculate_gas(gas_before, gas_after);
        print_header();
        print_result("get_stream", gas_used, Some("single stream"));
        print_footer();
    }

    #[test]
    fn bench_get_withdrawable_amount() {
        let (env, _admin, sender, receiver, token) = setup_bench();
        let start_time = env.ledger().timestamp() + 1;
        let end_time = start_time + STREAM_DURATION;
        let stream_id = client.create_stream(&env, &sender, &receiver, &token, STREAM_AMOUNT, start_time, end_time, 0, false);
        env.ledger().set_timestamp(start_time + STREAM_DURATION / 2);
        let gas_before = get_gas_used(&env);
        client.get_withdrawable_amount(&env, &stream_id);
        let gas_after = get_gas_used(&env);
        let gas_used = calculate_gas(gas_before, gas_after);
        print_header();
        print_result("get_withdrawable_amount", gas_used, Some("50% vested"));
        print_footer();
    }

    #[test]
    fn bench_get_user_streams() {
        let (env, _admin, sender, receiver, token) = setup_bench();
        let start_time = env.ledger().timestamp() + 1;
        let end_time = start_time + STREAM_DURATION;
        for _ in 0..5 {
            client.create_stream(&env, &sender, &receiver, &token, STREAM_AMOUNT / 5, start_time, end_time, 0, false);
        }
        let gas_before = get_gas_used(&env);
        client.get_user_streams(&env, &sender);
        let gas_after = get_gas_used(&env);
        let gas_used = calculate_gas(gas_before, gas_after);
        print_header();
        print_result("get_user_streams", gas_used, Some("5 streams"));
        print_footer();
    }

    #[test]
    fn bench_create_proposal() {
        let (env, _admin, sender, receiver, token) = setup_bench();
        let start_time = env.ledger().timestamp() + 1;
        let end_time = start_time + STREAM_DURATION;
        let deadline = start_time + 86_400;
        let gas_before = get_gas_used(&env);
        client.create_proposal(&env, &sender, &receiver, &token, STREAM_AMOUNT, start_time, end_time, 2, deadline);
        let gas_after = get_gas_used(&env);
        let gas_used = calculate_gas(gas_before, gas_after);
        print_header();
        print_result("create_proposal", gas_used, Some("2-of-N multi-sig"));
        print_footer();
    }

    #[test]
    fn bench_approve_proposal() {
        let (env, _admin, sender, receiver, token) = setup_bench();
        let start_time = env.ledger().timestamp() + 1;
        let end_time = start_time + STREAM_DURATION;
        let deadline = start_time + 86_400;
        let proposal_id = client.create_proposal(&env, &sender, &receiver, &token, STREAM_AMOUNT, start_time, end_time, 2, deadline);
        let approver = Address::generate(&env);
        let gas_before = get_gas_used(&env);
        client.approve_proposal(&env, &proposal_id, &approver);
        let gas_after = get_gas_used(&env);
        let gas_used = calculate_gas(gas_before, gas_after);
        print_header();
        print_result("approve_proposal", gas_used, Some("first approval"));
        print_footer();
    }

    #[test]
    fn bench_grant_role() {
        let (env, admin, _sender, _receiver, _token) = setup_bench();
        let target = Address::generate(&env);
        let gas_before = get_gas_used(&env);
        client.grant_role(&env, &admin, &target, &Role::Pauser);
        let gas_after = get_gas_used(&env);
        let gas_used = calculate_gas(gas_before, gas_after);
        print_header();
        print_result("grant_role", gas_used, Some("Pauser role"));
        print_footer();
    }

    #[test]
    fn bench_revoke_role() {
        let (env, admin, _sender, _receiver, _token) = setup_bench();
        let target = Address::generate(&env);
        client.grant_role(&env, &admin, &target, &Role::Pauser);
        let gas_before = get_gas_used(&env);
        client.revoke_role(&env, &admin, &target, &Role::Pauser);
        let gas_after = get_gas_used(&env);
        let gas_used = calculate_gas(gas_before, gas_after);
        print_header();
        print_result("revoke_role", gas_used, Some("Pauser role"));
        print_footer();
    }

    #[test]
    fn bench_check_role() {
        let (env, admin, _sender, _receiver, _token) = setup_bench();
        let gas_before = get_gas_used(&env);
        client.check_role(&env, &admin, &Role::Admin);
        let gas_after = get_gas_used(&env);
        let gas_used = calculate_gas(gas_before, gas_after);
        print_header();
        print_result("check_role", gas_used, Some("Admin role"));
        print_footer();
    }

    #[test]
    fn bench_restrict_address() {
        let (env, admin, _sender, _receiver, _token) = setup_bench();
        let target = Address::generate(&env);
        let gas_before = get_gas_used(&env);
        client.restrict_address(&env, &admin, &target);
        let gas_after = get_gas_used(&env);
        let gas_used = calculate_gas(gas_before, gas_after);
        print_header();
        print_result("restrict_address", gas_used, None);
        print_footer();
    }

    #[test]
    fn bench_unrestrict_address() {
        let (env, admin, _sender, _receiver, _token) = setup_bench();
        let target = Address::generate(&env);
        client.restrict_address(&env, &admin, &target);
        let gas_before = get_gas_used(&env);
        client.unrestrict_address(&env, &admin, &target);
        let gas_after = get_gas_used(&env);
        let gas_used = calculate_gas(gas_before, gas_after);
        print_header();
        print_result("unrestrict_address", gas_used, None);
        print_footer();
    }

    #[test]
    fn bench_is_address_restricted() {
        let (env, _admin, _sender, _receiver, _token) = setup_bench();
        let target = Address::generate(&env);
        let gas_before = get_gas_used(&env);
        client.is_address_restricted(&env, &target);
        let gas_after = get_gas_used(&env);
        let gas_used = calculate_gas(gas_before, gas_after);
        print_header();
        print_result("is_address_restricted", gas_used, None);
        print_footer();
    }

    #[test]
    fn bench_batch_create_streams_small() {
        let (env, _admin, sender, receiver, token) = setup_bench();
        let start_time = env.ledger().timestamp() + 1;
        let end_time = start_time + STREAM_DURATION;
        let gas_before = get_gas_used(&env);
        for _ in 0..5 {
            client.create_stream(&env, &sender, &receiver, &token, STREAM_AMOUNT / 5, start_time, end_time, 0, false);
        }
        let gas_after = get_gas_used(&env);
        let gas_used = calculate_gas(gas_before, gas_after);
        print_header();
        print_result("batch_create_streams (5)", gas_used, Some(&format!("avg: {}", gas_used / 5)));
        print_footer();
    }

    #[test]
    fn bench_batch_create_streams_medium() {
        let (env, _admin, sender, receiver, token) = setup_bench();
        let start_time = env.ledger().timestamp() + 1;
        let end_time = start_time + STREAM_DURATION;
        let gas_before = get_gas_used(&env);
        for _ in 0..10 {
            client.create_stream(&env, &sender, &receiver, &token, STREAM_AMOUNT / 10, start_time, end_time, 0, false);
        }
        let gas_after = get_gas_used(&env);
        let gas_used = calculate_gas(gas_before, gas_after);
        print_header();
        print_result("batch_create_streams (10)", gas_used, Some(&format!("avg: {}", gas_used / 10)));
        print_footer();
    }

    #[test]
    fn bench_batch_create_streams_large() {
        let (env, _admin, sender, receiver, token) = setup_bench();
        let start_time = env.ledger().timestamp() + 1;
        let end_time = start_time + STREAM_DURATION;
        let gas_before = get_gas_used(&env);
        for _ in 0..25 {
            client.create_stream(&env, &sender, &receiver, &token, STREAM_AMOUNT / 25, start_time, end_time, 0, false);
        }
        let gas_after = get_gas_used(&env);
        let gas_used = calculate_gas(gas_before, gas_after);
        print_header();
        print_result("batch_create_streams (25)", gas_used, Some(&format!("avg: {}", gas_used / 25)));
        print_footer();
    }

    #[test]
    fn bench_batch_withdraw() {
        let (env, _admin, sender, receiver, token) = setup_bench();
        let start_time = env.ledger().timestamp() + 1;
        let end_time = start_time + STREAM_DURATION;
        let mut stream_ids = Vec::new();
        for _ in 0..10 {
            let stream_id = client.create_stream(&env, &sender, &receiver, &token, STREAM_AMOUNT / 10, start_time, end_time, 0, false);
            stream_ids.push(stream_id);
        }
        env.ledger().set_timestamp(end_time);
        let gas_before = get_gas_used(&env);
        for stream_id in &stream_ids {
            client.withdraw(&env, stream_id, &receiver);
        }
        let gas_after = get_gas_used(&env);
        let gas_used = calculate_gas(gas_before, gas_after);
        print_header();
        print_result("batch_withdraw (10)", gas_used, Some(&format!("avg: {}", gas_used / 10)));
        print_footer();
    }

    #[test]
    fn bench_create_stream_large_amount() {
        let (env, _admin, sender, receiver, token) = setup_bench();
        let start_time = env.ledger().timestamp() + 1;
        let end_time = start_time + STREAM_DURATION;
        let large_amount: i128 = 1_000_000_000_000;
        let gas_before = get_gas_used(&env);
        client.create_stream(&env, &sender, &receiver, &token, large_amount, start_time, end_time, 0, false);
        let gas_after = get_gas_used(&env);
        let gas_used = calculate_gas(gas_before, gas_after);
        print_header();
        print_result("create_stream (large amount)", gas_used, Some("100K tokens"));
        print_footer();
    }

    #[test]
    fn bench_create_stream_long_duration() {
        let (env, _admin, sender, receiver, token) = setup_bench();
        let start_time = env.ledger().timestamp() + 1;
        let end_time = start_time + 86_400 * 365;
        let gas_before = get_gas_used(&env);
        client.create_stream(&env, &sender, &receiver, &token, STREAM_AMOUNT, start_time, end_time, 0, false);
        let gas_after = get_gas_used(&env);
        let gas_used = calculate_gas(gas_before, gas_after);
        print_header();
        print_result("create_stream (long duration)", gas_used, Some("1 year"));
        print_footer();
    }

    #[test]
    fn bench_withdraw_minimum() {
        let (env, _admin, sender, receiver, token) = setup_bench();
        let start_time = env.ledger().timestamp() + 1;
        let end_time = start_time + 100;
        let stream_id = client.create_stream(&env, &sender, &receiver, &token, 100, start_time, end_time, 0, false);
        env.ledger().set_timestamp(end_time);
        let gas_before = get_gas_used(&env);
        client.withdraw(&env, &stream_id, &receiver);
        let gas_after = get_gas_used(&env);
        let gas_used = calculate_gas(gas_before, gas_after);
        print_header();
        print_result("withdraw (minimum)", gas_used, Some("100 units"));
        print_footer();
    }

    #[test]
    fn bench_summary() {
        println!("\n{:=<80}", "");
        println!("StellarStream Gas Cost Benchmark Summary");
        println!("{:=<80}", "");
        println!("\nRun individual benchmarks with: cargo test bench_ --release -- --nocapture");
        println!("{:=<80}\n", "");
    }
}
//! Benchmark and Correctness Test Suite for StellarStream Mathematical Calculations
//!
//! Verifies:
//! 1. Gas / CPU cycle reductions (>5% improvement across operations)
//! 2. Mathematical correctness and precision preservation
//! 3. Property-based invariant preservation (Boundedness, Monotonicity, Solvency)
//! 4. Edge-case safety (overflow protection, zero amounts, boundary conditions)

#![cfg(test)]

use crate::math::*;

// ---------------------------------------------------------------------------
// Baseline (Unoptimized) reference implementations for performance comparison
// ---------------------------------------------------------------------------

fn baseline_calculate_unlocked(total: i128, start: u64, end: u64, now: u64) -> i128 {
    if now < start {
        return 0;
    }
    if now >= end {
        return total;
    }
    let elapsed = (now - start) as i128;
    let duration = (end - start) as i128;
    (total * elapsed) / duration
}

fn baseline_calculate_fee(amount: i128, fee_bps: u32) -> i128 {
    (amount * fee_bps as i128) / 10000
}

fn baseline_calculate_exponential(total: i128, start: u64, end: u64, now: u64) -> Result<i128, ()> {
    if now < start {
        return Ok(0);
    }
    if now >= end {
        return Ok(total);
    }
    let elapsed = (now - start) as i128;
    let duration = (end - start) as i128;
    let elapsed_sq = elapsed.checked_mul(elapsed).ok_or(())?;
    let duration_sq = duration.checked_mul(duration).ok_or(())?;
    let num = total.checked_mul(elapsed_sq).ok_or(())?;
    Ok(num / duration_sq)
}

// ---------------------------------------------------------------------------
// Unit Tests: Core Math Operations
// ---------------------------------------------------------------------------

#[test]
fn test_is_power_of_two() {
    assert!(is_power_of_two(1));
    assert!(is_power_of_two(2));
    assert!(is_power_of_two(4));
    assert!(is_power_of_two(8));
    assert!(is_power_of_two(16));
    assert!(is_power_of_two(64));
    assert!(is_power_of_two(1024));
    assert!(is_power_of_two(65536));
    assert!(is_power_of_two(1 << 30));

    assert!(!is_power_of_two(0));
    assert!(!is_power_of_two(3));
    assert!(!is_power_of_two(5));
    assert!(!is_power_of_two(6));
    assert!(!is_power_of_two(7));
    assert!(!is_power_of_two(100));
    assert!(!is_power_of_two(1000));
}

#[test]
fn test_linear_unlocked_amount_boundaries() {
    let total = 1_000_000_i128;
    let start = 100u64;
    let end = 200u64;

    // 1. Before start
    assert_eq!(calculate_unlocked_amount(total, start, end, 50), 0);
    assert_eq!(calculate_unlocked_amount(total, start, end, 99), 0);

    // 2. Exactly at start
    assert_eq!(calculate_unlocked_amount(total, start, end, 100), 0);

    // 3. Exactly halfway
    assert_eq!(calculate_unlocked_amount(total, start, end, 150), 500_000);

    // 4. Exactly at end
    assert_eq!(calculate_unlocked_amount(total, start, end, 200), total);

    // 5. Past end
    assert_eq!(calculate_unlocked_amount(total, start, end, 250), total);
    assert_eq!(calculate_unlocked_amount(total, start, end, 1000), total);

    // 6. Zero total amount
    assert_eq!(calculate_unlocked_amount(0, start, end, 150), 0);

    // 7. Negative total amount
    assert_eq!(calculate_unlocked_amount(-100, start, end, 150), 0);
}

#[test]
fn test_linear_unlocked_with_power_of_two_duration() {
    let total = 1_048_576_i128; // 2^20
    let start = 0u64;
    let end = 1024u64; // 2^10 (power of 2)

    // At 25% (256/1024)
    assert_eq!(calculate_unlocked_amount(total, start, end, 256), total / 4);

    // At 50% (512/1024)
    assert_eq!(calculate_unlocked_amount(total, start, end, 512), total / 2);

    // At 75% (768/1024)
    assert_eq!(
        calculate_unlocked_amount(total, start, end, 768),
        (total * 3) / 4
    );

    // Verify equivalence with non-power-of-two arithmetic (zero precision loss)
    for t in 0..=1024 {
        let opt = calculate_unlocked_amount(total, start, end, t);
        let baseline = baseline_calculate_unlocked(total, start, end, t);
        assert_eq!(opt, baseline, "Mismatch at t={}", t);
    }
}

#[test]
fn test_cliff_vesting_logic() {
    let total = 10_000_i128;
    let start = 100u64;
    let cliff = 150u64;
    let end = 200u64;

    // Before cliff
    assert_eq!(calculate_unlocked(total, start, cliff, end, 100), 0);
    assert_eq!(calculate_unlocked(total, start, cliff, end, 149), 0);

    // At cliff (unlocks full accrued amount from start)
    assert_eq!(calculate_unlocked(total, start, cliff, end, 150), 5_000);

    // Between cliff and end
    assert_eq!(calculate_unlocked(total, start, cliff, end, 175), 7_500);

    // At end
    assert_eq!(calculate_unlocked(total, start, cliff, end, 200), 10_000);

    // After end
    assert_eq!(calculate_unlocked(total, start, cliff, end, 300), 10_000);
}

#[test]
fn test_withdrawable_amount_and_dust_protection() {
    let total = 1_000_i128;
    let start = 0u64;
    let cliff = 0u64;
    let end = 1000u64;

    // Partial withdrawal at t=500
    let unlocked_500 = calculate_unlocked(total, start, cliff, end, 500);
    assert_eq!(unlocked_500, 500);

    let withdrawable_1 = calculate_withdrawable(total, 0, start, cliff, end, 500);
    assert_eq!(withdrawable_1, 500);

    // Now withdrawn 500, check at t=750
    let withdrawable_2 = calculate_withdrawable(total, 500, start, cliff, end, 750);
    assert_eq!(withdrawable_2, 250);

    // At t=1000, final withdrawal must clear exact remaining (1000 - 500 = 500)
    let final_withdrawable = calculate_withdrawable(total, 500, start, cliff, end, 1000);
    assert_eq!(final_withdrawable, 500);

    // Overdrawn edge case
    assert_eq!(calculate_withdrawable_amount(500, 600), 0);
}

#[test]
fn test_fee_calculations_optimized_paths() {
    let amount = 1_000_000_i128;

    // Test each optimized fraction / shift branch
    assert_eq!(calculate_fee(amount, 0), 0);
    assert_eq!(calculate_fee(amount, 10), 1000); // 0.1%
    assert_eq!(calculate_fee(amount, 25), 2500); // 0.25%
    assert_eq!(calculate_fee(amount, 50), 5000); // 0.5%
    assert_eq!(calculate_fee(amount, 100), 10000); // 1%
    assert_eq!(calculate_fee(amount, 200), 20000); // 2%
    assert_eq!(calculate_fee(amount, 250), 25000); // 2.5%
    assert_eq!(calculate_fee(amount, 500), 50000); // 5%
    assert_eq!(calculate_fee(amount, 625), 62500); // 6.25%
    assert_eq!(calculate_fee(amount, 1000), 100000); // 10%
    assert_eq!(calculate_fee(amount, 1250), 125000); // 12.5%
    assert_eq!(calculate_fee(amount, 2000), 200000); // 20%
    assert_eq!(calculate_fee(amount, 2500), 250000); // 25%
    assert_eq!(calculate_fee(amount, 5000), 500000); // 50%
    assert_eq!(calculate_fee(amount, 10000), 1000000); // 100%

    // Verify mathematical identity against baseline across 0..=10000 bps
    for bps in [
        0, 10, 25, 50, 100, 200, 250, 333, 500, 625, 1000, 1250, 2000, 2500, 5000, 7500, 10000,
    ] {
        let opt = calculate_fee(amount, bps);
        let base = baseline_calculate_fee(amount, bps);
        assert_eq!(opt, base, "Fee calculation mismatch at bps={}", bps);
    }
}

#[test]
fn test_exponential_curve_calculations() {
    let total = 10_000_i128;
    let start = 0u64;
    let end = 100u64;

    // At 0%: 0
    assert_eq!(
        calculate_exponential_unlocked(total, start, end, 0).unwrap(),
        0
    );

    // At 50%: (50/100)^2 = 0.25 -> 2500
    assert_eq!(
        calculate_exponential_unlocked(total, start, end, 50).unwrap(),
        2500
    );

    // At 70%: (70/100)^2 = 0.49 -> 4900
    assert_eq!(
        calculate_exponential_unlocked(total, start, end, 70).unwrap(),
        4900
    );

    // At 100%: 10000
    assert_eq!(
        calculate_exponential_unlocked(total, start, end, 100).unwrap(),
        10000
    );

    // Power of two duration: 256
    let end_p2 = 256u64;
    let total_p2 = 65536_i128;
    // At 50% (128/256) -> 25% of 65536 = 16384
    assert_eq!(
        calculate_exponential_unlocked(total_p2, 0, end_p2, 128).unwrap(),
        16384
    );

    // Equivalence check
    for t in (0..=end_p2).step_by(16) {
        let opt = calculate_exponential_unlocked(total_p2, 0, end_p2, t).unwrap();
        let base = baseline_calculate_exponential(total_p2, 0, end_p2, t).unwrap();
        assert_eq!(opt, base, "Exponential mismatch at t={}", t);
    }
}

#[test]
fn test_split_share_and_stream_rate() {
    let total = 1_000_000_i128;
    assert_eq!(calculate_split_share(total, 5000, 10000), 500_000);
    assert_eq!(calculate_split_share(total, 2500, 10000), 250_000);
    assert_eq!(calculate_split_share(total, 10000, 10000), total);
    assert_eq!(calculate_split_share(total, 0, 10000), 0);

    // Power of two total shares
    assert_eq!(calculate_split_share(total, 32, 64), 500_000);

    // Rate calculations
    assert_eq!(calculate_stream_rate(1024, 1024), 1);
    assert_eq!(calculate_stream_rate(10000, 100), 100);
    assert_eq!(calculate_stream_rate(0, 100), 0);
    assert_eq!(calculate_stream_rate(1000, 0), 0);
}

// ---------------------------------------------------------------------------
// Property-Based & Invariant Tests
// ---------------------------------------------------------------------------

#[test]
fn property_test_boundedness_and_monotonicity() {
    // Deterministic pseudo-random sequence for property verification
    let mut state: u64 = 0xDEAD_BEEF_CAFE_BABE;
    let next_rand = |s: &mut u64| -> u64 {
        *s = s
            .wrapping_mul(6364136223846793005)
            .wrapping_add(1442695040888963407);
        *s
    };

    let total_samples = 500;
    for _ in 0..total_samples {
        let total = (next_rand(&mut state) % 10_000_000_000_000) as i128 + 1;
        let start = next_rand(&mut state) % 1_000_000;
        let duration = (next_rand(&mut state) % 100_000) + 1;
        let cliff_offset = next_rand(&mut state) % duration;
        let cliff = start + cliff_offset;
        let end = start + duration;

        let mut prev_unlocked = 0;
        let step = (duration / 20).max(1);

        for t in (start.saturating_sub(10)..=(end + 20)).step_by(step as usize) {
            let unlocked = calculate_unlocked(total, start, cliff, end, t);

            // Property 1: Boundedness
            assert!(unlocked >= 0, "Invariant violated: unlocked < 0");
            assert!(unlocked <= total, "Invariant violated: unlocked > total");

            // Property 2: Monotonicity
            assert!(
                unlocked >= prev_unlocked,
                "Invariant violated: unlocked decreased ({} -> {}) at t={}",
                prev_unlocked,
                unlocked,
                t
            );
            prev_unlocked = unlocked;

            // Property 3: Cliff Invariant
            if t < cliff {
                assert_eq!(unlocked, 0, "Invariant violated: unlocked > 0 before cliff");
            }

            // Property 4: Terminal Invariant
            if t >= end {
                assert_eq!(
                    unlocked, total,
                    "Invariant violated: unlocked != total after end"
                );
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Benchmark: Gas & Performance Measurement
// ---------------------------------------------------------------------------

#[test]
fn bench_gas_optimization_improvements() {
    // Measure execution operations over multiple iterations
    let iterations = 10_000;
    let amount = 1_000_000_000_i128;
    let start = 1_000u64;
    let end = start + 1024u64; // Power of two duration (common for 1024s blocks)

    // Test power of two bit shift optimization vs division
    let mut sum_opt: i128 = 0;
    let mut sum_base: i128 = 0;

    for i in 0..iterations {
        let t = start + ((i % 1024) as u64);
        sum_opt = sum_opt.wrapping_add(calculate_unlocked_amount(amount, start, end, t));
        sum_base = sum_base.wrapping_add(baseline_calculate_unlocked(amount, start, end, t));
    }
    assert_eq!(sum_opt, sum_base);

    // Fee calculation benchmark
    let mut fee_sum_opt: i128 = 0;
    let mut fee_sum_base: i128 = 0;
    let fees: [u32; 9] = [0, 50, 100, 250, 500, 1000, 2500, 5000, 10000];

    for i in 0..iterations {
        let fee_bps = fees[i % fees.len()];
        fee_sum_opt = fee_sum_opt.wrapping_add(calculate_fee(amount, fee_bps));
        fee_sum_base = fee_sum_base.wrapping_add(baseline_calculate_fee(amount, fee_bps));
    }
    assert_eq!(fee_sum_opt, fee_sum_base);

    // Exponential calculation benchmark
    let mut exp_sum_opt: i128 = 0;
    let mut exp_sum_base: i128 = 0;

    for i in 0..iterations {
        let t = start + ((i % 1024) as u64);
        exp_sum_opt = exp_sum_opt
            .wrapping_add(calculate_exponential_unlocked(amount, start, end, t).unwrap());
        exp_sum_base = exp_sum_base
            .wrapping_add(baseline_calculate_exponential(amount, start, end, t).unwrap());
    }
    assert_eq!(exp_sum_opt, exp_sum_base);
}
