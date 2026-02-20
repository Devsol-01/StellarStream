#![no_std]

pub mod math;
mod test;
mod types;

use soroban_sdk::{contract, contractimpl, symbol_short, token, Address, Env};
pub use types::{DataKey, Stream};

#[contract]
pub struct StellarStream;

#[contractimpl]
impl StellarStream {
    pub fn create_stream(
        env: Env,
        sender: Address,
        receiver: Address,
        token: Address,
        amount: i128,
        start_time: u64,
        end_time: u64,
    ) -> u64 {
        // 1. Auth: Ensure the sender is the one signing this transaction
        sender.require_auth();

        // 2. Validation: Basic sanity checks
        if end_time <= start_time {
            panic!("End time must be after start time");
        }
        if amount <= 0 {
            panic!("Amount must be greater than zero");
        }

        // 3. Asset Transfer: Pull tokens into contract custody
        let token_client = token::Client::new(&env, &token);
        token_client.transfer(&sender, &env.current_contract_address(), &amount);

        // 4. Counter Logic: We need a key to track the next ID
        // Note: You'll need to add 'StreamId' to your DataKey enum (see below)
        let mut stream_id: u64 = env
            .storage()
            .instance()
            .get(&DataKey::StreamId)
            .unwrap_or(0);
        stream_id += 1;
        env.storage().instance().set(&DataKey::StreamId, &stream_id);

        // 5. State Management: Populate the Stream struct
        let stream = Stream {
            sender: sender.clone(),
            receiver,
            token,
            amount,
            start_time,
            end_time,
            withdrawn_amount: 0, // Initialized at zero per the issue
        };

        // Save to Persistent storage so it doesn't expire quickly
        env.storage()
            .persistent()
            .set(&DataKey::Stream(stream_id), &stream);

        // 6. Events: Inform indexers/frontends of the new stream
        env.events()
            .publish((symbol_short!("create"), sender), stream_id);

        stream_id
    }

    pub fn withdraw(env: Env, stream_id: u64, receiver: Address) -> i128 {
        // 1. Auth: Only the receiver can trigger this withdrawal
        receiver.require_auth();

        // 2. Fetch the Stream: Retrieve from Persistent storage
        let mut stream: Stream = env
            .storage()
            .persistent()
            .get(&DataKey::Stream(stream_id))
            .unwrap_or_else(|| panic!("Stream does not exist"));

        // 3. Security: Ensure the caller is the actual receiver of this stream
        if receiver != stream.receiver {
            panic!("Unauthorized: You are not the receiver of this stream");
        }

        // 4. Time Calculation: Get current ledger time
        let now = env.ledger().timestamp();

        // 5. Math Logic: Calculate total unlocked amount based on time
        // We pass the stream details to our math module
        let total_unlocked =
            math::calculate_unlocked(stream.amount, stream.start_time, stream.end_time, now);

        // 6. Calculate Withdrawable: (Unlocked so far) - (Already withdrawn)
        let withdrawable_amount = total_unlocked - stream.withdrawn_amount;

        if withdrawable_amount <= 0 {
            panic!("No funds available to withdraw at this time");
        }

        // 7. Token Transfer: Move funds from contract to receiver
        let token_client = token::Client::new(&env, &stream.token);
        token_client.transfer(
            &env.current_contract_address(),
            &receiver,
            &withdrawable_amount,
        );

        // 8. Update State: Increment the withdrawn_amount and save back to storage
        stream.withdrawn_amount += withdrawable_amount;
        env.storage()
            .persistent()
            .set(&DataKey::Stream(stream_id), &stream);

        // 9. Emit Event
        env.events().publish(
            (symbol_short!("withdraw"), receiver),
            (stream_id, withdrawable_amount),
        );

        withdrawable_amount
    }

    pub fn cancel_stream(env: Env, stream_id: u64) {
        // 1. Fetch the Stream first to identify the sender
        let stream: Stream = env
            .storage()
            .persistent()
            .get(&DataKey::Stream(stream_id))
            .unwrap_or_else(|| panic!("Stream does not exist"));

        // 2. Auth: Only the original sender can cancel the stream
        stream.sender.require_auth();

        let now = env.ledger().timestamp();

        // 3. Validation: If the stream is already finished, there's nothing to cancel
        if now >= stream.end_time {
            panic!("Stream has already completed and cannot be cancelled");
        }

        // 4. Calculate Final Split
        // Total Unlocked is what the receiver is entitled to up to this second
        let total_unlocked =
            math::calculate_unlocked(stream.amount, stream.start_time, stream.end_time, now);

        // Receiver gets: (What they are owed now) - (What they already took)
        let withdrawable_to_receiver = total_unlocked - stream.withdrawn_amount;

        // Sender gets: (Original Total) - (Total Unlocked for receiver)
        let refund_to_sender = stream.amount - total_unlocked;

        let token_client = token::Client::new(&env, &stream.token);
        let contract_address = env.current_contract_address();

        // 5. Execute Payouts
        // Step 1: Pay the receiver their final piece of the pie
        if withdrawable_to_receiver > 0 {
            token_client.transfer(
                &contract_address,
                &stream.receiver,
                &withdrawable_to_receiver,
            );
        }

        // Step 2: Refund the remaining balance to the sender
        if refund_to_sender > 0 {
            token_client.transfer(&contract_address, &stream.sender, &refund_to_sender);
        }

        // 6. Cleanup: Remove from Persistent storage to save ledger space and prevent re-entry
        env.storage()
            .persistent()
            .remove(&DataKey::Stream(stream_id));

        // 7. Emit Event
        env.events()
            .publish((symbol_short!("cancel"), stream_id), stream.sender);
    }
}
