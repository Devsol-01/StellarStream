import { ForecastingService } from "../services/forecasting.service.js";

// Mock the db module
jest.mock("../lib/db.js", () => {
  const mockPrisma = {
    $queryRaw: jest.fn(),
    $executeRaw: jest.fn(),
    disbursement: { count: jest.fn() },
    tokenPrice: {
      findFirst: jest.fn(),
    },
  };
  return { prisma: mockPrisma };
});

// Mock the logger
jest.mock("../logger.js", () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    event: jest.fn(),
  },
}));

import { prisma } from "../lib/db.js";

const mockedPrisma = prisma as jest.Mocked<typeof prisma>;

describe("ForecastingService", () => {
  let service: ForecastingService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ForecastingService();
  });

  describe("forecastVolume", () => {
    it("should return a valid volume forecast with predictions", async () => {
      // Generate 90 days of mock data
      const mockData = Array.from({ length: 90 }, (_, i) => {
        const d = new Date();
        d.setDate(d.getDate() - (89 - i));
        return {
          day: d.toISOString().split("T")[0],
          volume_usd: 1000 + Math.random() * 500,
          count: BigInt(Math.floor(Math.random() * 50) + 10),
        };
      });

      (mockedPrisma.$queryRaw as jest.Mock).mockResolvedValue(mockData);

      const result = await service.forecastVolume(4);

      // Should have 28 predictions (4 weeks x 7 days)
      expect(result.predictions).toHaveLength(28);
      expect(result.currency).toBe("USD");
      expect(result.trend).toBeDefined();
      expect(["up", "down", "stable"]).toContain(result.trend);
      expect(result.averagePredictedVolume).toBeGreaterThan(0);
      expect(result.metadata.accuracy).toBeGreaterThanOrEqual(0.8);
      expect(result.metadata.model).toBe("holt-double-exponential-smoothing");

      // Check each prediction has proper structure
      for (const pred of result.predictions) {
        expect(pred.date).toBeDefined();
        expect(pred.predictedVolumeUsd).toBeGreaterThanOrEqual(0);
        expect(pred.lowerBoundUsd).toBeGreaterThanOrEqual(0);
        expect(pred.upperBoundUsd).toBeGreaterThanOrEqual(pred.lowerBoundUsd);
        expect(pred.confidence).toBe(0.8);
      }
    });

    it("should handle insufficient data gracefully", async () => {
      (mockedPrisma.$queryRaw as jest.Mock).mockResolvedValue([]);

      const result = await service.forecastVolume(2);

      // Should have 14 predictions (fallback)
      expect(result.predictions).toHaveLength(14);
      expect(result.metadata.model).toBe("fallback-default");
      expect(result.metadata.accuracy).toBe(0.5);
    });

    it("should handle database errors", async () => {
      (mockedPrisma.$queryRaw as jest.Mock).mockRejectedValue(new Error("DB error"));

      await expect(service.forecastVolume(4)).rejects.toThrow("DB error");
    });
  });

  describe("forecastFailures", () => {
    it("should return failure rate predictions", async () => {
      const mockData = Array.from({ length: 90 }, (_, i) => {
        const d = new Date();
        d.setDate(d.getDate() - (89 - i));
        return {
          day: d.toISOString().split("T")[0],
          total: BigInt(Math.floor(Math.random() * 100) + 20),
          failed: BigInt(Math.floor(Math.random() * 10)),
        };
      });

      (mockedPrisma.$queryRaw as jest.Mock).mockResolvedValue(mockData);

      const result = await service.forecastFailures(4);

      expect(result.predictions).toHaveLength(28);
      expect(result.averageFailureRate).toBeGreaterThanOrEqual(0);
      expect(result.averageFailureRate).toBeLessThanOrEqual(1);
      expect(result.metadata.accuracy).toBeGreaterThanOrEqual(0.8);
    });
  });

  describe("estimateCosts", () => {
    it("should return cost estimates", async () => {
      const mockFeeData = Array.from({ length: 12 }, (_, i) => {
        const d = new Date();
        d.setDate(d.getDate() - (11 - i) * 7);
        const weekNum = Math.ceil((d.getDate() + new Date(d.getFullYear(), d.getMonth(), 1).getDay()) / 7);
        return {
          week: `${d.getFullYear()}-W${String(weekNum).padStart(2, "0")}`,
          avg_fee_stroops: 1500 + Math.random() * 500,
          tx_count: BigInt(Math.floor(Math.random() * 100) + 10),
        };
      });

      (mockedPrisma.$queryRaw as jest.Mock).mockResolvedValue(mockFeeData);
      (mockedPrisma.disbursement.count as jest.Mock).mockResolvedValue(1200);
      (mockedPrisma.tokenPrice.findFirst as jest.Mock).mockResolvedValue({
        tokenAddress: "native",
        priceUsd: 0.12,
        updatedAt: new Date(),
      });

      const result = await service.estimateCosts(4);

      expect(result.estimates).toHaveLength(4);
      expect(result.averageWeeklyCostXlm).toBeGreaterThan(0);
      expect(result.averageWeeklyCostUsd).toBeGreaterThan(0);

      for (const est of result.estimates) {
        expect(est.period).toBeDefined();
        expect(est.estimatedTotalXlm).toBeGreaterThan(0);
        expect(est.lowerBoundXlm).toBeLessThanOrEqual(est.estimatedTotalXlm);
        expect(est.upperBoundXlm).toBeGreaterThanOrEqual(est.estimatedTotalXlm);
        expect(est.confidence).toBeGreaterThan(0);
        expect(est.confidence).toBeLessThanOrEqual(1);
      }
    });
  });

  describe("identifyPeakTimes", () => {
    it("should identify peak transaction times", async () => {
      const mockData = [];
      for (let d = 0; d < 7; d++) {
        for (let h = 0; h < 24; h++) {
          mockData.push({
            day_of_week: d,
            hour_of_day: h,
            volume_usd: 100 + Math.random() * 900 * (h >= 9 && h <= 17 ? 2 : 1),
            tx_count: BigInt(Math.floor(Math.random() * 20) + 1),
          });
        }
      }

      (mockedPrisma.$queryRaw as jest.Mock).mockResolvedValue(mockData);

      const result = await service.identifyPeakTimes();

      expect(result.peaks.length).toBeGreaterThan(0);
      expect(result.quietPeriods.length).toBeGreaterThan(0);
      expect(result.busiestDayOfWeek.day).toBeDefined();
      expect(result.busiestHourOfDay.hour).toBeGreaterThanOrEqual(0);
      expect(result.busiestHourOfDay.hour).toBeLessThanOrEqual(23);

      // Verify peak slots have proper structure
      for (const peak of result.peaks) {
        expect(peak.dayOfWeek).toBeGreaterThanOrEqual(0);
        expect(peak.dayOfWeek).toBeLessThanOrEqual(6);
        expect(peak.hourOfDay).toBeGreaterThanOrEqual(0);
        expect(peak.hourOfDay).toBeLessThanOrEqual(23);
        expect(peak.percentile).toBeGreaterThan(0);
      }
    });

    it("should handle empty data", async () => {
      (mockedPrisma.$queryRaw as jest.Mock).mockResolvedValue([]);

      const result = await service.identifyPeakTimes();

      expect(result.metadata.model).toBe("fallback-default");
      expect(result.peaks).toHaveLength(0);
    });
  });

  describe("detectAnomalies", () => {
    it("should detect anomalies in payment patterns", async () => {
      // Generate data with a clear anomaly (one day with 10x volume)
      const mockData = Array.from({ length: 30 }, (_, i) => {
        const d = new Date();
        d.setDate(d.getDate() - (29 - i));
        const isAnomaly = i === 15; // day 15 has a spike
        return {
          day: d.toISOString().split("T")[0],
          volume_usd: isAnomaly ? 50000 : 1000 + Math.random() * 500,
          count: BigInt(isAnomaly ? 500 : Math.floor(Math.random() * 50) + 10),
          failed_count: BigInt(isAnomaly ? 50 : Math.floor(Math.random() * 3)),
        };
      });

      (mockedPrisma.$queryRaw as jest.Mock).mockResolvedValue(mockData);

      const result = await service.detectAnomalies();

      expect(result.anomalyCount).toBeGreaterThanOrEqual(1);
      // At least the volume anomaly should be detected
      const volumeAnomalies = result.anomalies.filter((a) => a.metric === "payment_volume_usd");
      expect(volumeAnomalies.length).toBeGreaterThanOrEqual(1);

      for (const anomaly of result.anomalies) {
        expect(anomaly.date).toBeDefined();
        expect(anomaly.metric).toBeDefined();
        expect(anomaly.zScore).toBeGreaterThanOrEqual(2);
        expect(["low", "medium", "high", "critical"]).toContain(anomaly.severity);
      }
    });

    it("should handle insufficient data", async () => {
      (mockedPrisma.$queryRaw as jest.Mock).mockResolvedValue(
        Array.from({ length: 5 }, (_, i) => ({
          day: `2024-01-0${i + 1}`,
          volume_usd: 1000,
          count: BigInt(10),
          failed_count: BigInt(1),
        })),
      );

      const result = await service.detectAnomalies();

      expect(result.anomalyCount).toBe(0);
    });
  });

  describe("generateWeeklyReport", () => {
    it("should generate a comprehensive weekly report", async () => {
      // Mock all dependent methods
      const mockVolumeData = Array.from({ length: 90 }, (_, i) => {
        const d = new Date();
        d.setDate(d.getDate() - (89 - i));
        return {
          day: d.toISOString().split("T")[0],
          volume_usd: 1000 + Math.random() * 500,
          count: BigInt(Math.floor(Math.random() * 50) + 10),
        };
      });

      const mockFailData = Array.from({ length: 90 }, (_, i) => {
        const d = new Date();
        d.setDate(d.getDate() - (89 - i));
        return {
          day: d.toISOString().split("T")[0],
          total: BigInt(Math.floor(Math.random() * 100) + 20),
          failed: BigInt(Math.floor(Math.random() * 10)),
        };
      });

      const mockFeeData = Array.from({ length: 12 }, (_, i) => {
        const d = new Date();
        d.setDate(d.getDate() - (11 - i) * 7);
        const weekNum = Math.ceil((d.getDate() + new Date(d.getFullYear(), d.getMonth(), 1).getDay()) / 7);
        return {
          week: `${d.getFullYear()}-W${String(weekNum).padStart(2, "0")}`,
          avg_fee_stroops: 1500 + Math.random() * 500,
          tx_count: BigInt(Math.floor(Math.random() * 100) + 10),
        };
      });

      const mockPeakData = [];
      for (let d = 0; d < 7; d++) {
        for (let h = 0; h < 24; h++) {
          mockPeakData.push({
            day_of_week: d,
            hour_of_day: h,
            volume_usd: 100 + Math.random() * 900 * (h >= 9 && h <= 17 ? 2 : 1),
            tx_count: BigInt(Math.floor(Math.random() * 20) + 1),
          });
        }
      }

      // $queryRaw is called multiple times - return appropriate mock for each call
      (mockedPrisma.$queryRaw as jest.Mock)
        .mockResolvedValueOnce(mockVolumeData) // forecastVolume
        .mockResolvedValueOnce(mockFailData) // forecastFailures
        .mockResolvedValueOnce(mockFeeData) // estimateCosts
        .mockResolvedValueOnce(mockPeakData) // identifyPeakTimes
        .mockResolvedValueOnce(mockVolumeData); // detectAnomalies (uses same volume data)

      (mockedPrisma.disbursement.count as jest.Mock).mockResolvedValue(1200);
      (mockedPrisma.tokenPrice.findFirst as jest.Mock).mockResolvedValue({
        tokenAddress: "native",
        priceUsd: 0.12,
        updatedAt: new Date(),
      });
      (mockedPrisma.$executeRaw as jest.Mock).mockResolvedValue(undefined);

      const report = await service.generateWeeklyReport();

      expect(report.reportId).toBeDefined();
      expect(report.weekStart).toBeDefined();
      expect(report.weekEnd).toBeDefined();
      expect(report.volumeForecast).toBeDefined();
      expect(report.failureForecast).toBeDefined();
      expect(report.costForecast).toBeDefined();
      expect(report.peakTimes).toBeDefined();
      expect(report.anomalies).toBeDefined();
      expect(report.summary).toBeDefined();
      expect(report.summary.length).toBeGreaterThan(0);
      expect(report.generatedAt).toBeDefined();
    });
  });

  describe("getLatestReport", () => {
    it("should return the latest report from DB", async () => {
      const mockReport = {
        reportId: "test-123",
        weekStart: "2024-01-01",
        weekEnd: "2024-01-07",
        volumeForecast: { currency: "USD", predictions: [], trend: "stable", averagePredictedVolume: 0, metadata: { model: "test", trainingPeriod: "", accuracy: 0.8, generatedAt: "" } },
        failureForecast: { predictions: [], averageFailureRate: 0, metadata: { model: "test", trainingPeriod: "", accuracy: 0.8, generatedAt: "" } },
        costForecast: { estimates: [], averageWeeklyCostXlm: 0, averageWeeklyCostUsd: 0, metadata: { model: "test", trainingPeriod: "", xlmSource: "", generatedAt: "" } },
        peakTimes: { peaks: [], quietPeriods: [], busiestDayOfWeek: { day: "", averageVolumeUsd: 0 }, busiestHourOfDay: { hour: 0, averageVolumeUsd: 0 }, metadata: { model: "", analysisPeriod: "", generatedAt: "" } },
        anomalies: { anomalies: [], anomalyCount: 0, metadata: { model: "", threshold: 2, analysisPeriod: "", generatedAt: "" } },
        summary: "Test summary",
        generatedAt: new Date().toISOString(),
      };

      (mockedPrisma.$queryRaw as jest.Mock).mockResolvedValue([{ report: mockReport }]);

      const result = await service.getLatestReport();

      expect(result).not.toBeNull();
      expect(result!.reportId).toBe("test-123");
    });

    it("should return null when no reports exist", async () => {
      (mockedPrisma.$queryRaw as jest.Mock).mockResolvedValue([]);

      const result = await service.getLatestReport();

      expect(result).toBeNull();
    });
  });
});

