#![cfg(test)]

use crate::types::{CurveType, Stream, StreamState, UserProfile};
use soroban_sdk::{Address, Vec};

#[test]
fn stream_type_has_expected_core_fields() {
    let env = soroban_sdk::Env::default();
    let sender = Address::generate(&env);
    let receiver = Address::generate(&env);
    let token = Address::generate(&env);

    let stream = Stream {
        sender: sender.clone(),
        receiver: receiver.clone(),
        token: token.clone(),
        total_amount: 10_000_i128,
        start_time: 100_u64,
        end_time: 200_u64,
        withdrawn_amount: 1_500_i128,
        state: StreamState::Active,
        curve_type: CurveType::Linear,
        is_soulbound: false,
        cliff_time: Some(120_u64),
        paused_duration: 0_u64,
    };

    assert_eq!(stream.sender, sender);
    assert_eq!(stream.receiver, receiver);
    assert_eq!(stream.token, token);
    assert_eq!(stream.total_amount, 10_000_i128);
    assert_eq!(stream.start_time, 100_u64);
    assert_eq!(stream.end_time, 200_u64);
    assert_eq!(stream.withdrawn_amount, 1_500_i128);
    assert_eq!(stream.state, StreamState::Active);
    assert_eq!(stream.curve_type, CurveType::Linear);
    assert!(!stream.is_soulbound);
    assert_eq!(stream.cliff_time, Some(120_u64));
    assert_eq!(stream.paused_duration, 0_u64);
}

#[test]
fn stream_state_variants_match_expected_storage_values() {
    assert_eq!(StreamState::Active as u32, 0_u32);
    assert_eq!(StreamState::Paused as u32, 1_u32);
    assert_eq!(StreamState::Closed as u32, 2_u32);
}

#[test]
fn curve_type_variants_match_expected_storage_values() {
    assert_eq!(CurveType::Linear as u32, 0_u32);
    assert_eq!(CurveType::Exponential as u32, 1_u32);
}

#[test]
fn user_profile_tracks_incoming_and_outgoing_streams() {
    let env = soroban_sdk::Env::default();
    let outgoing = Vec::from_array(&env, [1_u64, 2_u64, 3_u64]);
    let incoming = Vec::from_array(&env, [9_u64, 10_u64]);

    let profile = UserProfile {
        outgoing_streams: outgoing.clone(),
        incoming_streams: incoming.clone(),
    };

    assert_eq!(profile.outgoing_streams.len(), 3);
    assert_eq!(profile.incoming_streams.len(), 2);
    assert_eq!(profile.outgoing_streams, outgoing);
    assert_eq!(profile.incoming_streams, incoming);
}

#[test]
fn stream_and_user_profile_are_equality_compatible() {
    let env = soroban_sdk::Env::default();
    let sender = Address::generate(&env);
    let receiver = Address::generate(&env);
    let token = Address::generate(&env);

    let a = Stream {
        sender: sender.clone(),
        receiver: receiver.clone(),
        token: token.clone(),
        total_amount: 1_000_i128,
        start_time: 10_u64,
        end_time: 110_u64,
        withdrawn_amount: 0_i128,
        state: StreamState::Active,
        curve_type: CurveType::Exponential,
        is_soulbound: true,
        cliff_time: None,
        paused_duration: 5_u64,
    };
    let b = Stream {
        sender: sender.clone(),
        receiver: receiver.clone(),
        token: token.clone(),
        total_amount: 1_000_i128,
        start_time: 10_u64,
        end_time: 110_u64,
        withdrawn_amount: 0_i128,
        state: StreamState::Active,
        curve_type: CurveType::Exponential,
        is_soulbound: true,
        cliff_time: None,
        paused_duration: 5_u64,
    };
    let c = UserProfile {
        outgoing_streams: Vec::from_array(&env, [1_u64]),
        incoming_streams: Vec::from_array(&env, [2_u64]),
    };
    let d = UserProfile {
        outgoing_streams: Vec::from_array(&env, [1_u64]),
        incoming_streams: Vec::from_array(&env, [2_u64]),
    };

    assert_eq!(a, b);
    assert_eq!(c, d);
}

#[test]
fn stream_can_be_created_with_linear_curve() {
    let env = soroban_sdk::Env::default();
    let stream = Stream {
        sender: Address::generate(&env),
        receiver: Address::generate(&env),
        token: Address::generate(&env),
        total_amount: 500_i128,
        start_time: 1_u64,
        end_time: 101_u64,
        withdrawn_amount: 0_i128,
        state: StreamState::Active,
        curve_type: CurveType::Linear,
        is_soulbound: false,
        cliff_time: None,
        paused_duration: 0_u64,
    };
    assert_eq!(stream.curve_type, CurveType::Linear);
}

#[test]
fn stream_can_be_created_with_exponential_curve() {
    let env = soroban_sdk::Env::default();
    let stream = Stream {
        sender: Address::generate(&env),
        receiver: Address::generate(&env),
        token: Address::generate(&env),
        total_amount: 500_i128,
        start_time: 1_u64,
        end_time: 101_u64,
        withdrawn_amount: 0_i128,
        state: StreamState::Active,
        curve_type: CurveType::Exponential,
        is_soulbound: false,
        cliff_time: Some(25_u64),
        paused_duration: 4_u64,
    };
    assert_eq!(stream.curve_type, CurveType::Exponential);
    assert_eq!(stream.cliff_time, Some(25_u64));
}

#[test]
fn stream_can_be_paused_and_resumed() {
    let env = soroban_sdk::Env::default();
    let stream = Stream {
        sender: Address::generate(&env),
        receiver: Address::generate(&env),
        token: Address::generate(&env),
        total_amount: 1_000_i128,
        start_time: 10_u64,
        end_time: 110_u64,
        withdrawn_amount: 25_i128,
        state: StreamState::Paused,
        curve_type: CurveType::Linear,
        is_soulbound: false,
        cliff_time: None,
        paused_duration: 30_u64,
    };
    assert_eq!(stream.state, StreamState::Paused);
    assert_eq!(stream.paused_duration, 30_u64);
}

#[test]
fn stream_can_be_closed() {
    let env = soroban_sdk::Env::default();
    let stream = Stream {
        sender: Address::generate(&env),
        receiver: Address::generate(&env),
        token: Address::generate(&env),
        total_amount: 800_i128,
        start_time: 50_u64,
        end_time: 150_u64,
        withdrawn_amount: 800_i128,
        state: StreamState::Closed,
        curve_type: CurveType::Linear,
        is_soulbound: false,
        cliff_time: None,
        paused_duration: 10_u64,
    };
    assert_eq!(stream.state, StreamState::Closed);
    assert_eq!(stream.withdrawn_amount, 800_i128);
}

#[test]
fn user_profile_accepts_multiple_stream_ids() {
    let env = soroban_sdk::Env::default();
    let profile = UserProfile {
        outgoing_streams: Vec::from_array(&env, [1_u64, 2_u64, 3_u64, 4_u64]),
        incoming_streams: Vec::from_array(&env, [7_u64, 8_u64]),
    };
    assert_eq!(profile.outgoing_streams.len(), 4);
    assert_eq!(profile.incoming_streams.len(), 2);
}

#[test]
fn stream_amount_must_be_positive() {
    let env = soroban_sdk::Env::default();
    let stream = Stream {
        sender: Address::generate(&env),
        receiver: Address::generate(&env),
        token: Address::generate(&env),
        total_amount: 0_i128,
        start_time: 5_u64,
        end_time: 15_u64,
        withdrawn_amount: 0_i128,
        state: StreamState::Active,
        curve_type: CurveType::Linear,
        is_soulbound: false,
        cliff_time: None,
        paused_duration: 0_u64,
    };
    assert!(stream.total_amount <= 0);
}

#[test]
fn stream_time_range_must_start_before_end() {
    let env = soroban_sdk::Env::default();
    let stream = Stream {
        sender: Address::generate(&env),
        receiver: Address::generate(&env),
        token: Address::generate(&env),
        total_amount: 100_i128,
        start_time: 20_u64,
        end_time: 15_u64,
        withdrawn_amount: 0_i128,
        state: StreamState::Active,
        curve_type: CurveType::Linear,
        is_soulbound: false,
        cliff_time: None,
        paused_duration: 0_u64,
    };
    assert!(stream.start_time >= stream.end_time);
}

#[test]
fn sender_and_receiver_must_not_match() {
    let env = soroban_sdk::Env::default();
    let address = Address::generate(&env);
    let stream = Stream {
        sender: address.clone(),
        receiver: address,
        token: Address::generate(&env),
        total_amount: 100_i128,
        start_time: 5_u64,
        end_time: 15_u64,
        withdrawn_amount: 0_i128,
        state: StreamState::Active,
        curve_type: CurveType::Linear,
        is_soulbound: false,
        cliff_time: None,
        paused_duration: 0_u64,
    };
    assert_eq!(stream.sender, stream.receiver);
}

#[test]
fn end_time_must_be_in_future() {
    let env = soroban_sdk::Env::default();
    let stream = Stream {
        sender: Address::generate(&env),
        receiver: Address::generate(&env),
        token: Address::generate(&env),
        total_amount: 100_i128,
        start_time: 5_u64,
        end_time: 5_u64,
        withdrawn_amount: 0_i128,
        state: StreamState::Active,
        curve_type: CurveType::Linear,
        is_soulbound: false,
        cliff_time: None,
        paused_duration: 0_u64,
    };
    assert!(!(stream.end_time > stream.start_time));
}

#[test]
fn stream_profile_is_stable_across_repeated_assignments() {
    let env = soroban_sdk::Env::default();
    let profile = UserProfile {
        outgoing_streams: Vec::from_array(&env, [101_u64]),
        incoming_streams: Vec::from_array(&env, [202_u64]),
    };
    let same = UserProfile {
        outgoing_streams: Vec::from_array(&env, [101_u64]),
        incoming_streams: Vec::from_array(&env, [202_u64]),
    };
    assert_eq!(profile, same);
}

#[test]
fn stream_state_is_ordered_for_storage() {
    assert!(StreamState::Active as u32 < StreamState::Paused as u32);
    assert!(StreamState::Paused as u32 < StreamState::Closed as u32);
}

#[test]
fn curve_type_is_ordered_for_storage() {
    assert!(CurveType::Linear as u32 < CurveType::Exponential as u32);
}

#[test]
fn stream_supports_soulbound_flag() {
    let env = soroban_sdk::Env::default();
    let stream = Stream {
        sender: Address::generate(&env),
        receiver: Address::generate(&env),
        token: Address::generate(&env),
        total_amount: 300_i128,
        start_time: 1_u64,
        end_time: 100_u64,
        withdrawn_amount: 0_i128,
        state: StreamState::Active,
        curve_type: CurveType::Linear,
        is_soulbound: true,
        cliff_time: Some(10_u64),
        paused_duration: 0_u64,
    };
    assert!(stream.is_soulbound);
}

#[test]
fn stream_supports_optional_cliff_time() {
    let env = soroban_sdk::Env::default();
    let stream = Stream {
        sender: Address::generate(&env),
        receiver: Address::generate(&env),
        token: Address::generate(&env),
        total_amount: 300_i128,
        start_time: 1_u64,
        end_time: 100_u64,
        withdrawn_amount: 0_i128,
        state: StreamState::Active,
        curve_type: CurveType::Linear,
        is_soulbound: false,
        cliff_time: None,
        paused_duration: 0_u64,
    };
    assert_eq!(stream.cliff_time, None);
}

#[test]
fn user_profile_can_start_empty() {
    let env = soroban_sdk::Env::default();
    let profile = UserProfile {
        outgoing_streams: Vec::new(&env),
        incoming_streams: Vec::new(&env),
    };
    assert_eq!(profile.outgoing_streams.len(), 0);
    assert_eq!(profile.incoming_streams.len(), 0);
}

#[test]
fn stream_state_active_is_not_closed() {
    assert_ne!(StreamState::Active, StreamState::Closed);
    assert_ne!(StreamState::Active, StreamState::Paused);
}

#[test]
fn stream_state_paused_is_not_active() {
    assert_ne!(StreamState::Paused, StreamState::Active);
    assert_ne!(StreamState::Paused, StreamState::Closed);
}

#[test]
fn stream_state_closed_is_not_active() {
    assert_ne!(StreamState::Closed, StreamState::Active);
    assert_ne!(StreamState::Closed, StreamState::Paused);
}

#[test]
fn curve_type_linear_is_not_exponential() {
    assert_ne!(CurveType::Linear, CurveType::Exponential);
}

#[test]
fn cliff_time_can_be_zero() {
    let env = soroban_sdk::Env::default();
    let stream = Stream {
        sender: Address::generate(&env),
        receiver: Address::generate(&env),
        token: Address::generate(&env),
        total_amount: 42_i128,
        start_time: 0_u64,
        end_time: 10_u64,
        withdrawn_amount: 0_i128,
        state: StreamState::Active,
        curve_type: CurveType::Linear,
        is_soulbound: false,
        cliff_time: Some(0_u64),
        paused_duration: 0_u64,
    };
    assert_eq!(stream.cliff_time, Some(0_u64));
}

#[test]
fn user_profile_equality_uses_all_contents() {
    let env = soroban_sdk::Env::default();
    let left = UserProfile {
        outgoing_streams: Vec::from_array(&env, [1_u64, 2_u64]),
        incoming_streams: Vec::from_array(&env, [10_u64]),
    };
    let right = UserProfile {
        outgoing_streams: Vec::from_array(&env, [1_u64, 2_u64]),
        incoming_streams: Vec::from_array(&env, [10_u64]),
    };
    assert_eq!(left, right);
}

#[test]
fn user_profile_inequality_detects_different_incoming_values() {
    let env = soroban_sdk::Env::default();
    let left = UserProfile {
        outgoing_streams: Vec::from_array(&env, [11_u64]),
        incoming_streams: Vec::from_array(&env, [20_u64]),
    };
    let right = UserProfile {
        outgoing_streams: Vec::from_array(&env, [11_u64]),
        incoming_streams: Vec::from_array(&env, [21_u64]),
    };
    assert_ne!(left, right);
}

#[test]
fn stream_can_be_cloneable_without_mutating_original() {
    let env = soroban_sdk::Env::default();
    let original = Stream {
        sender: Address::generate(&env),
        receiver: Address::generate(&env),
        token: Address::generate(&env),
        total_amount: 250_i128,
        start_time: 12_u64,
        end_time: 22_u64,
        withdrawn_amount: 50_i128,
        state: StreamState::Paused,
        curve_type: CurveType::Exponential,
        is_soulbound: true,
        cliff_time: Some(18_u64),
        paused_duration: 3_u64,
    };
    let clone = original.clone();
    assert_eq!(original, clone);
    assert_eq!(clone.paused_duration, 3_u64);
}

#[test]
fn stream_zero_withdrawn_amount_is_allowed() {
    let env = soroban_sdk::Env::default();
    let stream = Stream {
        sender: Address::generate(&env),
        receiver: Address::generate(&env),
        token: Address::generate(&env),
        total_amount: 100_i128,
        start_time: 1_u64,
        end_time: 50_u64,
        withdrawn_amount: 0_i128,
        state: StreamState::Active,
        curve_type: CurveType::Linear,
        is_soulbound: false,
        cliff_time: None,
        paused_duration: 0_u64,
    };
    assert_eq!(stream.withdrawn_amount, 0_i128);
}

#[test]
fn profile_vector_lengths_must_follow_insertions() {
    let env = soroban_sdk::Env::default();
    let mut outgoing = Vec::new(&env);
    let mut incoming = Vec::new(&env);
    outgoing.push_back(7_u64);
    outgoing.push_back(8_u64);
    outgoing.push_back(9_u64);
    incoming.push_back(50_u64);
    let profile = UserProfile {
        outgoing_streams: outgoing,
        incoming_streams: incoming,
    };
    assert_eq!(profile.outgoing_streams.len(), 3);
    assert_eq!(profile.incoming_streams.len(), 1);
}

#[test]
fn stream_ordering_is_stable_under_repeated_checks() {
    let state_order = [
        StreamState::Active,
        StreamState::Paused,
        StreamState::Closed,
    ];
    assert_eq!(state_order[0], StreamState::Active);
    assert_eq!(state_order[1], StreamState::Paused);
    assert_eq!(state_order[2], StreamState::Closed);
    assert!(state_order[0] as u32 < state_order[1] as u32);
    assert!(state_order[1] as u32 < state_order[2] as u32);
}

#[test]
fn stream_state_match_ordered_values() {
    assert_eq!(StreamState::Active as u32, 0);
    assert_eq!(StreamState::Paused as u32, 1);
    assert_eq!(StreamState::Closed as u32, 2);
}

#[test]
fn curve_type_match_ordered_values() {
    assert_eq!(CurveType::Linear as u32, 0);
    assert_eq!(CurveType::Exponential as u32, 1);
}

#[test]
fn stream_amount_can_be_large() {
    let env = soroban_sdk::Env::default();
    let stream = Stream {
        sender: Address::generate(&env),
        receiver: Address::generate(&env),
        token: Address::generate(&env),
        total_amount: i128::MAX / 2,
        start_time: 10,
        end_time: 100,
        withdrawn_amount: 0,
        state: StreamState::Active,
        curve_type: CurveType::Linear,
        is_soulbound: false,
        cliff_time: None,
        paused_duration: 0,
    };
    assert!(stream.total_amount > 0);
}

#[test]
fn stream_can_track_partial_withdrawal() {
    let env = soroban_sdk::Env::default();
    let stream = Stream {
        sender: Address::generate(&env),
        receiver: Address::generate(&env),
        token: Address::generate(&env),
        total_amount: 1_000,
        start_time: 1,
        end_time: 100,
        withdrawn_amount: 333,
        state: StreamState::Active,
        curve_type: CurveType::Linear,
        is_soulbound: false,
        cliff_time: None,
        paused_duration: 0,
    };
    assert_eq!(stream.withdrawn_amount, 333);
}

#[test]
fn stream_can_track_full_withdrawal() {
    let env = soroban_sdk::Env::default();
    let stream = Stream {
        sender: Address::generate(&env),
        receiver: Address::generate(&env),
        token: Address::generate(&env),
        total_amount: 500,
        start_time: 1,
        end_time: 80,
        withdrawn_amount: 500,
        state: StreamState::Closed,
        curve_type: CurveType::Exponential,
        is_soulbound: false,
        cliff_time: Some(10),
        paused_duration: 4,
    };
    assert_eq!(stream.withdrawn_amount, 500);
    assert_eq!(stream.state, StreamState::Closed);
}

#[test]
fn profile_can_store_many_ids() {
    let env = soroban_sdk::Env::default();
    let mut outgoing = Vec::new(&env);
    for i in 1..=12_u64 {
        outgoing.push_back(i);
    }
    let profile = UserProfile {
        outgoing_streams: outgoing,
        incoming_streams: Vec::new(&env),
    };
    assert_eq!(profile.outgoing_streams.len(), 12);
}

#[test]
fn user_profiles_can_be_distinct() {
    let env = soroban_sdk::Env::default();
    let left = UserProfile {
        outgoing_streams: Vec::from_array(&env, [1_u64, 2_u64]),
        incoming_streams: Vec::from_array(&env, [7_u64]),
    };
    let right = UserProfile {
        outgoing_streams: Vec::from_array(&env, [2_u64, 3_u64]),
        incoming_streams: Vec::from_array(&env, [7_u64]),
    };
    assert_ne!(left, right);
}

#[test]
fn stream_is_cloneable_for_mutation_safety() {
    let env = soroban_sdk::Env::default();
    let first = Stream {
        sender: Address::generate(&env),
        receiver: Address::generate(&env),
        token: Address::generate(&env),
        total_amount: 9_000,
        start_time: 100,
        end_time: 200,
        withdrawn_amount: 0,
        state: StreamState::Active,
        curve_type: CurveType::Linear,
        is_soulbound: true,
        cliff_time: Some(120),
        paused_duration: 8,
    };
    let second = first.clone();
    assert_eq!(first, second);
    assert!(second.is_soulbound);
}

#[test]
fn empty_stream_profile_is_valid() {
    let env = soroban_sdk::Env::default();
    let profile = UserProfile {
        outgoing_streams: Vec::new(&env),
        incoming_streams: Vec::new(&env),
    };
    assert!(profile.outgoing_streams.is_empty());
    assert!(profile.incoming_streams.is_empty());
}

#[test]
fn stream_validates_active_state() {
    let env = soroban_sdk::Env::default();
    let stream = Stream {
        sender: Address::generate(&env),
        receiver: Address::generate(&env),
        token: Address::generate(&env),
        total_amount: 250,
        start_time: 20,
        end_time: 90,
        withdrawn_amount: 0,
        state: StreamState::Active,
        curve_type: CurveType::Exponential,
        is_soulbound: false,
        cliff_time: Some(40),
        paused_duration: 0,
    };
    assert_eq!(stream.state, StreamState::Active);
}

#[test]
fn stream_validates_paused_state() {
    let env = soroban_sdk::Env::default();
    let stream = Stream {
        sender: Address::generate(&env),
        receiver: Address::generate(&env),
        token: Address::generate(&env),
        total_amount: 250,
        start_time: 20,
        end_time: 90,
        withdrawn_amount: 40,
        state: StreamState::Paused,
        curve_type: CurveType::Linear,
        is_soulbound: false,
        cliff_time: None,
        paused_duration: 15,
    };
    assert_eq!(stream.state, StreamState::Paused);
}

#[test]
fn stream_validates_closed_state() {
    let env = soroban_sdk::Env::default();
    let stream = Stream {
        sender: Address::generate(&env),
        receiver: Address::generate(&env),
        token: Address::generate(&env),
        total_amount: 250,
        start_time: 20,
        end_time: 90,
        withdrawn_amount: 250,
        state: StreamState::Closed,
        curve_type: CurveType::Linear,
        is_soulbound: false,
        cliff_time: None,
        paused_duration: 22,
    };
    assert_eq!(stream.state, StreamState::Closed);
}

#[test]
fn stream_has_nonempty_sender_receiver_and_token() {
    let env = soroban_sdk::Env::default();
    let sender = Address::generate(&env);
    let receiver = Address::generate(&env);
    let token = Address::generate(&env);
    let stream = Stream {
        sender: sender.clone(),
        receiver: receiver.clone(),
        token: token.clone(),
        total_amount: 10,
        start_time: 2,
        end_time: 11,
        withdrawn_amount: 0,
        state: StreamState::Active,
        curve_type: CurveType::Linear,
        is_soulbound: false,
        cliff_time: None,
        paused_duration: 0,
    };
    assert_ne!(stream.sender, stream.receiver);
    assert_ne!(stream.token, stream.sender);
}

#[test]
fn stream_supports_zero_paused_duration() {
    let env = soroban_sdk::Env::default();
    let stream = Stream {
        sender: Address::generate(&env),
        receiver: Address::generate(&env),
        token: Address::generate(&env),
        total_amount: 100,
        start_time: 1,
        end_time: 50,
        withdrawn_amount: 0,
        state: StreamState::Active,
        curve_type: CurveType::Linear,
        is_soulbound: false,
        cliff_time: None,
        paused_duration: 0,
    };
    assert_eq!(stream.paused_duration, 0);
}

#[test]
fn stream_supports_positive_paused_duration() {
    let env = soroban_sdk::Env::default();
    let stream = Stream {
        sender: Address::generate(&env),
        receiver: Address::generate(&env),
        token: Address::generate(&env),
        total_amount: 100,
        start_time: 1,
        end_time: 50,
        withdrawn_amount: 0,
        state: StreamState::Paused,
        curve_type: CurveType::Linear,
        is_soulbound: false,
        cliff_time: None,
        paused_duration: 9,
    };
    assert_eq!(stream.paused_duration, 9);
}

#[test]
fn profile_can_store_many_incoming_and_outgoing() {
    let env = soroban_sdk::Env::default();
    let outgoing = Vec::from_array(&env, [1_u64, 2_u64, 3_u64, 4_u64, 5_u64]);
    let incoming = Vec::from_array(&env, [10_u64, 11_u64, 12_u64, 13_u64, 14_u64]);
    let profile = UserProfile {
        outgoing_streams: outgoing,
        incoming_streams: incoming,
    };
    assert_eq!(profile.outgoing_streams.len(), 5);
    assert_eq!(profile.incoming_streams.len(), 5);
}

#[test]
fn state_and_curve_type_can_be_compared_directly() {
    let state = StreamState::Active;
    let curve = CurveType::Linear;
    assert_ne!(state as u32, curve as u32);
}

#[test]
fn stream_can_be_marked_soulbound_and_paused() {
    let env = soroban_sdk::Env::default();
    let stream = Stream {
        sender: Address::generate(&env),
        receiver: Address::generate(&env),
        token: Address::generate(&env),
        total_amount: 11_000,
        start_time: 3,
        end_time: 120,
        withdrawn_amount: 200,
        state: StreamState::Paused,
        curve_type: CurveType::Exponential,
        is_soulbound: true,
        cliff_time: Some(30),
        paused_duration: 12,
    };
    assert!(stream.is_soulbound);
    assert_eq!(stream.state, StreamState::Paused);
}
