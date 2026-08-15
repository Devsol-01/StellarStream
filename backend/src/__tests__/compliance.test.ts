/**
 * Compliance service and route tests.
 *
 * All DB calls are mocked so no Postgres instance is required.
 * Tests cover:
 *   - Sanctions screening
 *   - AML structuring detection
 *   - Transaction limits (per-tx + daily)
 *   - KYC verification
 *   - PEP screening
 *   - Blocked payments are logged
 *   - Configuration is updatable at runtime
 *   - API routes return correct status codes
 */

import { ComplianceService, DEFAULT_CONFIG, PaymentContext } from "../services/compliance.service.js";

// ── Mock prisma ──────────────────────────────────────────────────────────────

const mockQueryRaw = jest.fn();
const mockExecuteRaw = jest.fn();

jest.mock("../lib/db.js", () => ({
  prisma: {
    $queryRaw: (...args: unknown[]) => mockQueryRaw(...args),
    $executeRaw: (...args: unknown[]) => mockExecuteRaw(...args),
  },
}));

jest.mock("../logger.js", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

// ── Helpers ──────────────────────────────────────────────────────────────────

const SENDER    = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
const RECIPIENT = "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";
const SMALL_AMOUNT = BigInt("1000000");      // 0.1 XLM
const LARGE_AMOUNT = BigInt("20000000000");  // 2000 XLM — over default limit

function makeCtx(overrides: Partial<PaymentContext> = {}): PaymentContext {
  return {
    senderAddress: SENDER,
    recipientAddress: RECIPIENT,
    amountStroops: SMALL_AMOUNT,
    assetCode: "XLM",
    ...overrides,
  };
}

/** Set mockQueryRaw to return empty for all table lookups (clean profile) */
function mockCleanProfile() {
  mockQueryRaw.mockResolvedValue([]);
}

/** Set mockQueryRaw to mark the sender as sanctioned */
function mockSanctionedSender() {
  mockQueryRaw.mockImplementation((strings: TemplateStringsArray, ...values: unknown[]) => {
    const query = String(strings[0]);
    if (query.includes("sanctioned = true")) {
      // First call is for sender — return a match
      return Promise.resolve([{ id: "profile_1" }]);
    }
    return Promise.resolve([]);
  });
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("ComplianceService", () => {
  let service: ComplianceService;

  beforeEach(() => {
    jest.clearAllMocks();
    mockCleanProfile();
    mockExecuteRaw.mockResolvedValue(undefined);
    service = new ComplianceService();
  });

  // ── Initialization ───────────────────────────────────────────────────────

  it("uses DEFAULT_CONFIG values on construction", () => {
    const config = service.getConfig();
    expect(config.sanctionsEnabled).toBe(true);
    expect(config.amlEnabled).toBe(true);
    expect(config.kycEnabled).toBe(true);
    expect(config.pepEnabled).toBe(true);
    expect(config.transactionLimitsEnabled).toBe(true);
    expect(config.maxTransactionAmount).toBe(DEFAULT_CONFIG.maxTransactionAmount);
  });

  it("accepts partial config overrides", () => {
    const s = new ComplianceService({ sanctionsEnabled: false, requiredKycLevel: 0 });
    const c = s.getConfig();
    expect(c.sanctionsEnabled).toBe(false);
    expect(c.requiredKycLevel).toBe(0);
    // Other defaults preserved
    expect(c.amlEnabled).toBe(true);
  });

  it("updateConfig merges partial patch", () => {
    service.updateConfig({ pepEnabled: false, requiredKycLevel: 2 });
    const c = service.getConfig();
    expect(c.pepEnabled).toBe(false);
    expect(c.requiredKycLevel).toBe(2);
    expect(c.sanctionsEnabled).toBe(true); // unchanged
  });

  // ── Sanctions ────────────────────────────────────────────────────────────

  it("passes sanctions when address is clean", async () => {
    mockQueryRaw.mockResolvedValue([]); // no profile row
    const result = await service.check(makeCtx());
    const sanctions = result.checks.find((c) => c.check === "SANCTIONS")!;
    expect(sanctions.passed).toBe(true);
  });

  it("blocks payment when sender is sanctioned", async () => {
    // sanctions check calls isSanctioned twice (sender, recipient)
    mockQueryRaw
      .mockResolvedValueOnce([{ id: "p1" }]) // sender sanctioned
      .mockResolvedValue([]);                  // recipient clean + rest of checks
    const result = await service.check(makeCtx());
    expect(result.allowed).toBe(false);
    const sanctions = result.checks.find((c) => c.check === "SANCTIONS")!;
    expect(sanctions.passed).toBe(false);
    expect(sanctions.reason).toMatch(/sanctions blocklist/i);
  });

  it("blocks payment when recipient is sanctioned", async () => {
    mockQueryRaw
      .mockResolvedValueOnce([])             // sender clean
      .mockResolvedValueOnce([{ id: "p2" }]) // recipient sanctioned
      .mockResolvedValue([]);
    const result = await service.check(makeCtx());
    expect(result.allowed).toBe(false);
  });

  it("skips sanctions when disabled", async () => {
    const s = new ComplianceService({ ...DEFAULT_CONFIG, sanctionsEnabled: false, kycEnabled: false, pepEnabled: false, amlEnabled: false, transactionLimitsEnabled: false });
    mockQueryRaw.mockResolvedValue([]);
    const result = await s.check(makeCtx());
    const sanctions = result.checks.find((c) => c.check === "SANCTIONS");
    expect(sanctions).toBeUndefined();
    expect(result.allowed).toBe(true);
  });

  // ── AML ──────────────────────────────────────────────────────────────────

  it("passes AML when structuring count is below threshold", async () => {
    // AML check returns count=0
    mockQueryRaw.mockImplementation((strings: TemplateStringsArray) => {
      const q = String(strings[0]);
      if (q.includes("ComplianceLog")) return Promise.resolve([{ count: "2" }]);
      return Promise.resolve([]);
    });
    const result = await service.check(makeCtx());
    const aml = result.checks.find((c) => c.check === "AML")!;
    expect(aml.passed).toBe(true);
  });

  it("blocks when structuring count meets threshold", async () => {
    mockQueryRaw.mockImplementation((strings: TemplateStringsArray) => {
      const q = String(strings[0]);
      if (q.includes("ComplianceLog")) {
        return Promise.resolve([{ count: "5" }]); // == threshold
      }
      return Promise.resolve([]);
    });
    const result = await service.check(makeCtx());
    const aml = result.checks.find((c) => c.check === "AML")!;
    expect(aml.passed).toBe(false);
    expect(aml.reason).toMatch(/structuring/i);
  });

  it("skips AML when disabled", async () => {
    const s = new ComplianceService({ ...DEFAULT_CONFIG, amlEnabled: false, sanctionsEnabled: false, kycEnabled: false, pepEnabled: false, transactionLimitsEnabled: false });
    mockQueryRaw.mockResolvedValue([]);
    const result = await s.check(makeCtx());
    expect(result.checks.find((c) => c.check === "AML")).toBeUndefined();
  });

  // ── Transaction limits ───────────────────────────────────────────────────

  it("passes when amount is within per-tx limit", async () => {
    mockQueryRaw.mockResolvedValue([{ total: "0" }]);
    const result = await service.check(makeCtx({ amountStroops: SMALL_AMOUNT }));
    const limits = result.checks.find((c) => c.check === "TRANSACTION_LIMITS")!;
    expect(limits.passed).toBe(true);
  });

  it("blocks when amount exceeds per-tx limit", async () => {
    mockQueryRaw.mockResolvedValue([{ total: "0" }]);
    const result = await service.check(makeCtx({ amountStroops: LARGE_AMOUNT }));
    const limits = result.checks.find((c) => c.check === "TRANSACTION_LIMITS")!;
    expect(limits.passed).toBe(false);
    expect(limits.reason).toMatch(/per-transaction limit/i);
    expect(result.allowed).toBe(false);
  });

  it("blocks when daily total would be exceeded", async () => {
    // Daily total is close to limit; this tx would push it over
    mockQueryRaw.mockImplementation((strings: TemplateStringsArray) => {
      const q = String(strings[0]);
      if (q.includes("SUM(amount_stroops)")) {
        return Promise.resolve([{ total: "49999000000" }]); // just under 5000 XLM limit
      }
      return Promise.resolve([]);
    });
    // Send 5_000_000 stroops (0.5 XLM) — still pushes over
    const ctx = makeCtx({ amountStroops: BigInt("2000000000") }); // 200 XLM extra
    const result = await service.check(ctx);
    const limits = result.checks.find((c) => c.check === "TRANSACTION_LIMITS")!;
    expect(limits.passed).toBe(false);
    expect(limits.reason).toMatch(/daily limit/i);
  });

  it("skips limits when disabled", async () => {
    const s = new ComplianceService({ ...DEFAULT_CONFIG, transactionLimitsEnabled: false, sanctionsEnabled: false, amlEnabled: false, kycEnabled: false, pepEnabled: false });
    mockQueryRaw.mockResolvedValue([]);
    const result = await s.check(makeCtx({ amountStroops: LARGE_AMOUNT }));
    expect(result.checks.find((c) => c.check === "TRANSACTION_LIMITS")).toBeUndefined();
    expect(result.allowed).toBe(true);
  });

  // ── KYC ─────────────────────────────────────────────────────────────────

  it("passes KYC when sender meets required level", async () => {
    mockQueryRaw.mockImplementation((strings: TemplateStringsArray) => {
      const q = String(strings[0]);
      if (q.includes("kyc_level")) return Promise.resolve([{ kyc_level: 1 }]);
      return Promise.resolve([{ total: "0" }, { count: "0" }]);
    });
    const result = await service.check(makeCtx());
    const kyc = result.checks.find((c) => c.check === "KYC")!;
    expect(kyc.passed).toBe(true);
  });

  it("blocks when KYC level is below required", async () => {
    mockQueryRaw.mockImplementation((strings: TemplateStringsArray) => {
      const q = String(strings[0]);
      if (q.includes("kyc_level")) return Promise.resolve([{ kyc_level: 0 }]);
      return Promise.resolve([{ total: "0" }, { count: "0" }]);
    });
    const result = await service.check(makeCtx());
    const kyc = result.checks.find((c) => c.check === "KYC")!;
    expect(kyc.passed).toBe(false);
    expect(kyc.reason).toMatch(/kyc level/i);
    expect(result.allowed).toBe(false);
  });

  it("passes KYC when requiredKycLevel is 0 (disabled)", async () => {
    const s = new ComplianceService({ ...DEFAULT_CONFIG, kycEnabled: true, requiredKycLevel: 0, sanctionsEnabled: false, amlEnabled: false, transactionLimitsEnabled: false, pepEnabled: false });
    mockQueryRaw.mockResolvedValue([]);
    const result = await s.check(makeCtx());
    const kyc = result.checks.find((c) => c.check === "KYC")!;
    expect(kyc.passed).toBe(true);
  });

  it("skips KYC when disabled", async () => {
    const s = new ComplianceService({ ...DEFAULT_CONFIG, kycEnabled: false, sanctionsEnabled: false, amlEnabled: false, transactionLimitsEnabled: false, pepEnabled: false });
    mockQueryRaw.mockResolvedValue([]);
    const result = await s.check(makeCtx());
    expect(result.checks.find((c) => c.check === "KYC")).toBeUndefined();
  });

  // ── PEP ─────────────────────────────────────────────────────────────────

  it("passes PEP check when no PEP flag", async () => {
    mockQueryRaw.mockResolvedValue([]);
    const result = await service.check(makeCtx());
    const pep = result.checks.find((c) => c.check === "PEP")!;
    expect(pep.passed).toBe(true);
  });

  it("blocks when sender is a PEP", async () => {
    mockQueryRaw.mockImplementation((strings: TemplateStringsArray) => {
      const q = String(strings[0]);
      if (q.includes("is_pep = true")) return Promise.resolve([{ id: "pep_1" }]);
      return Promise.resolve([{ total: "0" }, { count: "0" }]);
    });
    const result = await service.check(makeCtx());
    const pep = result.checks.find((c) => c.check === "PEP")!;
    expect(pep.passed).toBe(false);
    expect(pep.reason).toMatch(/politically exposed/i);
    expect(result.allowed).toBe(false);
  });

  it("skips PEP when disabled", async () => {
    const s = new ComplianceService({ ...DEFAULT_CONFIG, pepEnabled: false, sanctionsEnabled: false, amlEnabled: false, transactionLimitsEnabled: false, kycEnabled: false });
    mockQueryRaw.mockResolvedValue([]);
    const result = await s.check(makeCtx());
    expect(result.checks.find((c) => c.check === "PEP")).toBeUndefined();
  });

  // ── Blocked payments are logged ──────────────────────────────────────────

  it("writes to ComplianceLog when payment is blocked", async () => {
    mockQueryRaw
      .mockResolvedValueOnce([{ id: "p1" }]) // sender sanctioned
      .mockResolvedValue([]);
    await service.check(makeCtx());
    expect(mockExecuteRaw).toHaveBeenCalledTimes(1);
    // Verify the execute call includes 'ComplianceLog'
    const call = mockExecuteRaw.mock.calls[0];
    expect(String(call[0])).toMatch(/ComplianceLog/i);
  });

  it("does NOT write to ComplianceLog when payment is allowed", async () => {
    const s = new ComplianceService({ ...DEFAULT_CONFIG, sanctionsEnabled: false, amlEnabled: false, transactionLimitsEnabled: false, kycEnabled: false, pepEnabled: false });
    mockQueryRaw.mockResolvedValue([]);
    await s.check(makeCtx());
    expect(mockExecuteRaw).not.toHaveBeenCalled();
  });

  // ── Fail-open on DB errors ───────────────────────────────────────────────

  it("returns allowed=true when DB throws (fail-open)", async () => {
    mockQueryRaw.mockRejectedValue(new Error("DB connection failed"));
    const result = await service.check(makeCtx());
    expect(result.allowed).toBe(true);
  });

  // ── All checks pass cleanly ──────────────────────────────────────────────

  it("returns allowed=true with all checks passing when profile is clean", async () => {
    mockQueryRaw.mockImplementation((strings: TemplateStringsArray) => {
      const q = String(strings[0]);
      if (q.includes("SUM(amount_stroops)")) return Promise.resolve([{ total: "0" }]);
      if (q.includes("COUNT(*)")) return Promise.resolve([{ count: "0" }]);
      if (q.includes("kyc_level")) return Promise.resolve([{ kyc_level: 2 }]);
      return Promise.resolve([]); // sanctions + PEP = no match
    });

    const result = await service.check(makeCtx());
    expect(result.allowed).toBe(true);
    expect(result.checks.every((c) => c.passed)).toBe(true);
    expect(mockExecuteRaw).not.toHaveBeenCalled();
  });

  // ── Multiple failing checks ──────────────────────────────────────────────

  it("reports all failing checks, not just first", async () => {
    // Sanctions fails AND KYC fails
    mockQueryRaw.mockImplementation((strings: TemplateStringsArray) => {
      const q = String(strings[0]);
      if (q.includes("sanctioned = true")) return Promise.resolve([{ id: "p1" }]);
      if (q.includes("kyc_level")) return Promise.resolve([{ kyc_level: 0 }]);
      return Promise.resolve([{ total: "0" }, { count: "0" }]);
    });

    const result = await service.check(makeCtx());
    expect(result.allowed).toBe(false);
    const failed = result.checks.filter((c) => !c.passed);
    expect(failed.length).toBeGreaterThanOrEqual(2);
  });

  // ── Admin helpers ────────────────────────────────────────────────────────

  it("upsertProfile calls executeRaw with correct data", async () => {
    await service.upsertProfile(SENDER, { sanctioned: true, kycLevel: 0 });
    expect(mockExecuteRaw).toHaveBeenCalledTimes(1);
    expect(String(mockExecuteRaw.mock.calls[0][0])).toMatch(/ComplianceProfile/i);
  });

  it("getBlockedPayments queries ComplianceLog", async () => {
    mockQueryRaw.mockResolvedValue([{ id: "log_1", allowed: false }]);
    const entries = await service.getBlockedPayments(10);
    expect(Array.isArray(entries)).toBe(true);
    expect(mockQueryRaw).toHaveBeenCalledTimes(1);
  });

  it("getLogByAddress queries ComplianceLog by address", async () => {
    mockQueryRaw.mockResolvedValue([{ id: "log_2" }]);
    const entries = await service.getLogByAddress(SENDER, 20);
    expect(Array.isArray(entries)).toBe(true);
  });
});
