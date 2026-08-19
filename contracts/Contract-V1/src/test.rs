//! Core functionality sanity tests.
#![cfg(test)]

use super::*;
use crate::common::*;

#[test]
fn test_initialize() {
    let f = setup();
    // Admin is stored after initialization.
    assert!(client(&f.env, &f.contract).next_stream_id() >= 1);
}

#[test]
fn test_initialize_is_idempotent() {
    let f = setup();
    let c = client(&f.env, &f.contract);
    // Second initialize must be rejected.
    assert!(c.try_initialize(&f.admin).is_err());
}

#[test]
fn test_create_and_get_stream() {
    let f = setup();
    let c = client(&f.env, &f.contract);
    let id = c.create_stream(
        &f.sender,
        &f.receiver,
        &f.token,
        &1_000_000i128,
        &0u64,
        &1_000u64,
        &CURVE_LINEAR,
        &false,
    );
    let s = c.get_stream(&id);
    assert_eq!(s.total_amount, 1_000_000i128);
    assert_eq!(s.state, STATE_ACTIVE);
}

#[test]
fn test_get_time_remaining_and_percentage() {
    let f = setup();
    let c = client(&f.env, &f.contract);
    
    // Set current ledger time
    f.env.ledger().with_mut(|li| {
        li.timestamp = 100;
    });

    let id = c.create_stream(
        &f.sender,
        &f.receiver,
        &f.token,
        &1_000_000i128,
        &100u64, // start time
        &1100u64, // end time (1000s duration)
        &CURVE_LINEAR,
        &false,
    );

    // Initial state: 0 seconds elapsed
    assert_eq!(c.get_time_remaining_seconds(&id), 1000);
    assert_eq!(c.get_time_remaining_days(&id), 0);
    assert_eq!(c.get_completion_percentage(&id), 0);

    // Mid stream: 500 seconds elapsed
    f.env.ledger().with_mut(|li| {
        li.timestamp = 600;
    });
    assert_eq!(c.get_time_remaining_seconds(&id), 500);
    assert_eq!(c.get_completion_percentage(&id), 5000); // 50%

    // Near end: 999 seconds elapsed
    f.env.ledger().with_mut(|li| {
        li.timestamp = 1099;
    });
    assert_eq!(c.get_time_remaining_seconds(&id), 1);
    assert_eq!(c.get_completion_percentage(&id), 9990); // 99.9%

    // Stream finished: 1000 seconds elapsed
    f.env.ledger().with_mut(|li| {
        li.timestamp = 1100;
    });
    assert_eq!(c.get_time_remaining_seconds(&id), 0);
    assert_eq!(c.get_completion_percentage(&id), 10000); // 100%

    // Stream past end: 2000 seconds elapsed
    f.env.ledger().with_mut(|li| {
        li.timestamp = 2100;
    });
    assert_eq!(c.get_time_remaining_seconds(&id), 0);
    assert_eq!(c.get_completion_percentage(&id), 10000); // 100%
}
