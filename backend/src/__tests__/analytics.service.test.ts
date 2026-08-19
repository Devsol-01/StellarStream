import { beforeEach, describe, expect, it, vi } from "vitest";
import { AnalyticsService } from "../services/analytics.service.js";
import { prisma } from "../lib/db.js";

vi.mock("../lib/db.js", () => ({
  prisma: {
    $queryRaw: vi.fn(),
    paymentCategory: {
      findMany: vi.fn(),
    },
  },
}));

describe("AnalyticsService.getPaymentAggregations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("builds time-series and category breakdowns for payment analysis", async () => {
    const service = new AnalyticsService();
    const mockQueryRaw = vi.mocked(prisma.$queryRaw);

    mockQueryRaw
      .mockResolvedValueOnce([
        {
          bucket: "2026-07-01",
          count: 2,
          total_amount_usd: "1200",
          completed_count: 1,
          pending_count: 1,
          failed_count: 0,
        },
      ])
      .mockResolvedValueOnce([
        {
          recipient: "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
          count: 2,
          total_amount_usd: "1200",
        },
      ])
      .mockResolvedValueOnce([
        {
          asset: "USDC",
          count: 2,
          total_amount_usd: "1200",
        },
      ])
      .mockResolvedValueOnce([
        {
          status: "COMPLETED",
          count: 1,
          total_amount_usd: "800",
        },
        {
          status: "PENDING",
          count: 1,
          total_amount_usd: "400",
        },
      ])
      .mockResolvedValueOnce([
        {
          category: "Payroll",
          count: 2,
          total_amount_usd: "1200",
        },
      ])
      .mockResolvedValueOnce([
        {
          region: "North America",
          count: 2,
          total_amount_usd: "1200",
        },
      ]);

    vi.mocked(prisma.paymentCategory.findMany).mockResolvedValue([
      { id: "cat-1", name: "Payroll" },
    ] as never);

    const result = await service.getPaymentAggregations("month");

    expect(result.summary.totalAmountUsd).toBe("1200");
    expect(result.summary.transactionCount).toBe(2);
    expect(result.timeSeries[0]).toEqual(
      expect.objectContaining({
        label: "2026-07-01",
        totalAmountUsd: "1200",
        count: 2,
      }),
    );
    expect(result.byRecipient[0]).toEqual(
      expect.objectContaining({
        recipient: "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
        totalAmountUsd: "1200",
      }),
    );
    expect(result.byStatus).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ status: "COMPLETED", count: 1 }),
        expect.objectContaining({ status: "PENDING", count: 1 }),
      ]),
    );
    expect(result.byCategory[0]).toEqual(
      expect.objectContaining({ category: "Payroll", totalAmountUsd: "1200" }),
    );
    expect(result.byGeography[0]).toEqual(
      expect.objectContaining({ region: "North America", totalAmountUsd: "1200" }),
    );
  });
});
