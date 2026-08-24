import { Router, Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
import {
  getOverview,
  computeGasCostStats,
  computeTopUsers,
  computeErrorRates,
} from "./metrics";
import {
  getAlertHistory,
  getAlertConfigs,
  createAlertConfig,
  updateAlertConfig,
  deleteAlertConfig,
} from "./alerts";

const router = Router();
const prisma = new PrismaClient();

router.get("/overview", async (_req: Request, res: Response) => {
  try {
    const overview = await getOverview();
    res.json(overview);
  } catch (error) {
    console.error("[Dashboard] Error fetching overview:", error);
    res.status(500).json({ error: "Failed to fetch overview" });
  }
});

router.get("/activity", async (req: Request, res: Response) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 25));
    const skip = (page - 1) * limit;

    const eventType = req.query.eventType as string | undefined;
    const sender = req.query.sender as string | undefined;
    const contractAddress = req.query.contractAddress as string | undefined;

    const where: Record<string, unknown> = {};
    if (eventType) where.eventType = eventType;
    if (sender) where.sender = sender;
    if (contractAddress) where.contractAddress = contractAddress;

    const [items, total] = await Promise.all([
      prisma.recentActivity.findMany({
        where,
        orderBy: { timestamp: "desc" },
        skip,
        take: limit,
      }),
      prisma.recentActivity.count({ where }),
    ]);

    res.json({
      items,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error("[Dashboard] Error fetching activity:", error);
    res.status(500).json({ error: "Failed to fetch activity" });
  }
});

router.get("/gas-stats", async (_req: Request, res: Response) => {
  try {
    const stats = await computeGasCostStats();
    res.json(stats);
  } catch (error) {
    console.error("[Dashboard] Error fetching gas stats:", error);
    res.status(500).json({ error: "Failed to fetch gas stats" });
  }
});

router.get("/errors", async (req: Request, res: Response) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 25));
    const skip = (page - 1) * limit;

    const resolved = req.query.resolved as string | undefined;
    const where: Record<string, unknown> = {};
    if (resolved !== undefined) where.resolved = resolved === "true";

    const [items, total] = await Promise.all([
      prisma.errorLog.findMany({
        where,
        orderBy: { timestamp: "desc" },
        skip,
        take: limit,
      }),
      prisma.errorLog.count({ where }),
    ]);

    res.json({
      items,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error("[Dashboard] Error fetching errors:", error);
    res.status(500).json({ error: "Failed to fetch errors" });
  }
});

router.get("/top-users", async (req: Request, res: Response) => {
  try {
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));
    const users = await computeTopUsers(limit);
    res.json(users);
  } catch (error) {
    console.error("[Dashboard] Error fetching top users:", error);
    res.status(500).json({ error: "Failed to fetch top users" });
  }
});

router.get("/admin-operations", async (req: Request, res: Response) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 25));
    const skip = (page - 1) * limit;

    const [items, total] = await Promise.all([
      prisma.adminOperation.findMany({
        orderBy: { timestamp: "desc" },
        skip,
        take: limit,
      }),
      prisma.adminOperation.count(),
    ]);

    res.json({
      items,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error("[Dashboard] Error fetching admin operations:", error);
    res.status(500).json({ error: "Failed to fetch admin operations" });
  }
});

router.get("/alerts/history", async (req: Request, res: Response) => {
  try {
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit as string) || 50));
    const history = await getAlertHistory(limit);
    res.json(history);
  } catch (error) {
    console.error("[Dashboard] Error fetching alert history:", error);
    res.status(500).json({ error: "Failed to fetch alert history" });
  }
});

router.get("/alerts/config", async (_req: Request, res: Response) => {
  try {
    const configs = await getAlertConfigs();
    res.json(configs);
  } catch (error) {
    console.error("[Dashboard] Error fetching alert configs:", error);
    res.status(500).json({ error: "Failed to fetch alert configs" });
  }
});

router.post("/alerts/config", async (req: Request, res: Response) => {
  try {
    const { metric, threshold, direction, webhookUrl } = req.body;

    if (!metric || threshold === undefined || !direction) {
      return res.status(400).json({ error: "metric, threshold, and direction are required" });
    }

    if (!["below", "above", "equals"].includes(direction)) {
      return res.status(400).json({ error: "direction must be 'below', 'above', or 'equals'" });
    }

    const config = await createAlertConfig(metric, threshold, direction, webhookUrl);
    res.status(201).json(config);
  } catch (error) {
    console.error("[Dashboard] Error creating alert config:", error);
    res.status(500).json({ error: "Failed to create alert config" });
  }
});

router.put("/alerts/config/:id", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { metric, threshold, direction, enabled, webhookUrl } = req.body;

    const data: Record<string, unknown> = {};
    if (metric !== undefined) data.metric = metric;
    if (threshold !== undefined) data.threshold = threshold;
    if (direction !== undefined) data.direction = direction;
    if (enabled !== undefined) data.enabled = enabled;
    if (webhookUrl !== undefined) data.webhookUrl = webhookUrl;

    const config = await updateAlertConfig(id, data);
    res.json(config);
  } catch (error) {
    console.error("[Dashboard] Error updating alert config:", error);
    res.status(500).json({ error: "Failed to update alert config" });
  }
});

router.delete("/alerts/config/:id", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await deleteAlertConfig(id);
    res.status(204).send();
  } catch (error) {
    console.error("[Dashboard] Error deleting alert config:", error);
    res.status(500).json({ error: "Failed to delete alert config" });
  }
});

router.get("/health", async (_req: Request, res: Response) => {
  try {
    const dbOk = await prisma.$queryRaw`SELECT 1`.then(() => true).catch(() => false);
    const recentCount = await prisma.recentActivity.count();
    const lastActivity = await prisma.recentActivity.findFirst({
      orderBy: { timestamp: "desc" },
      select: { timestamp: true },
    });

    res.json({
      status: dbOk ? "healthy" : "degraded",
      timestamp: new Date().toISOString(),
      database: dbOk ? "connected" : "disconnected",
      recentEvents: recentCount,
      lastActivityAt: lastActivity?.timestamp?.toISOString() ?? null,
      uptime: process.uptime(),
      memoryUsage: process.memoryUsage(),
    });
  } catch (error) {
    console.error("[Dashboard] Error in health check:", error);
    res.status(500).json({ status: "error", error: String(error) });
  }
});

export default router;
