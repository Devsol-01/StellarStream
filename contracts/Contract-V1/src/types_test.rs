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
