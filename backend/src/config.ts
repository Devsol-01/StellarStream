import { z } from 'zod';

// ─── Environment Variable Schema ─────────────────────────────────────────────
const envSchema = z.object({
  DATABASE_URL: z.string().url({
    message:
      'DATABASE_URL must be a valid URL (e.g. postgresql://user:pass@host:5432/stellarstream)',
  }),

  STELLAR_RPC_URL: z.string().url({
    message:
      'STELLAR_RPC_URL must be a valid URL (e.g. https://soroban-testnet.stellar.org)',
  }),

  CONTRACT_ID: z
    .string()
    .min(1, { message: 'CONTRACT_ID is required' })
    .regex(/^C[A-Z2-7]{55}$/, {
      message:
        'CONTRACT_ID must be a valid Stellar contract address (56 chars, starting with "C")',
    }),

  NETWORK_PASSPHRASE: z
    .string()
    .min(1, { message: 'NETWORK_PASSPHRASE is required' }),
});

// ─── Validate at startup ──────────────────────────────────────────────────────
const result = envSchema.safeParse(process.env);

if (!result.success) {
  const errors = result.error.issues
    .map((issue) => `  ✗ ${String(issue.path[0])}: ${issue.message}`)
    .join('\n');

  console.error('\n❌ Missing or invalid environment variables:\n');
  console.error(errors);
  console.error('\n💡 Copy backend/.env.example to backend/.env and fill in the values.\n');
  process.exit(1);
}

// ─── Exports ─────────────────────────────────────────────────────────────────

/**
 * Validated, type-safe environment config.
 * Import this throughout the backend instead of accessing process.env directly.
 *
 * @example
 * import { env } from './config.js';
 * const client = new StellarSdk.SorobanRpc.Server(env.STELLAR_RPC_URL);
 */
export const env = result.data;

export type Env = z.infer<typeof envSchema>;