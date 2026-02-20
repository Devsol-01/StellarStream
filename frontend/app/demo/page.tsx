'use client';

import { useState } from 'react';
import { StellarAddressInput } from '@/components/stellar-address-input';

export default function DemoPage() {
  const [address, setAddress] = useState('');
  const [isValid, setIsValid] = useState(false);

  return (
    <div className="min-h-screen p-8">
      {/* Background Effects */}
      <div className="fixed inset-0 -z-10 overflow-hidden">
        <div className="nebula-blob nebula-cyan" />
        <div className="nebula-blob nebula-violet" />
      </div>

      <div className="max-w-2xl mx-auto space-y-8">
        <div className="text-center space-y-4">
          <h1 className="text-4xl font-heading font-bold liquid-chrome">
            Stellar Address Input
          </h1>
          <p className="text-white/60">
            Enter a Stellar G-Address or Federated name to see validation in action
          </p>
        </div>

        <div className="glass-card p-8 space-y-6">
          <StellarAddressInput
            value={address}
            onChange={setAddress}
            onValidationChange={setIsValid}
            label="Recipient Address"
            placeholder="G... or name*stellar.org"
          />

          <div className="pt-4 border-t border-white/10">
            <h3 className="text-sm font-semibold text-white/80 mb-3">
              Try these examples:
            </h3>
            <div className="space-y-2">
              <button
                onClick={() => setAddress('GCDNJUBQSX7AJWLJACMJ7I4BC3Z47BQUTMHEICZLE6MU4KQBRYG5JY6B')}
                className="block w-full text-left px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 transition-colors text-sm font-mono text-white/70"
              >
                Valid G-Address
              </button>
              <button
                onClick={() => setAddress('alice*stellar.org')}
                className="block w-full text-left px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 transition-colors text-sm font-mono text-white/70"
              >
                Valid Federated Address
              </button>
              <button
                onClick={() => setAddress('INVALID123')}
                className="block w-full text-left px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 transition-colors text-sm font-mono text-white/70"
              >
                Invalid Address
              </button>
            </div>
          </div>

          {isValid && (
            <div className="glass-card p-4 border-green-500/30">
              <p className="text-green-500 text-sm">
                ✓ Ready to send payment to this address
              </p>
            </div>
          )}
        </div>

        <div className="glass-card p-6 space-y-4 text-sm text-white/60">
          <h3 className="text-white font-semibold">Features:</h3>
          <ul className="space-y-2 list-disc list-inside">
            <li>Validates Stellar G-Addresses (56 characters starting with G)</li>
            <li>Validates Federated addresses (name*domain.tld format)</li>
            <li>Green glow border on success with recipient avatar placeholder</li>
            <li>Hyper Violet shake animation on error</li>
            <li>Clear, contextual error messages</li>
            <li>Debounced validation for better UX</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
