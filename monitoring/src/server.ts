import express from "express";
import cron from "node-cron";
import path from "path";
import { PrismaClient } from "@prisma/client";
import { config } from "./config";
import dashboardRouter from "./dashboard";
import { indexNewEvents, startIndexer } from "./indexer";
import { storeMetricsSnapshot } from "./metrics";
import { checkAlerts, initializeDefaultAlerts } from "./alerts";

const prisma = new PrismaClient();
const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(express.static(path.join(__dirname, "..", "dashboard")));

app.use("/api", dashboardRouter);

app.get("/", (_req, res) => {
  res.sendFile(path.join(__dirname, "..", "dashboard", "index.html"));
});

app.get("*", (req, res) => {
  if (req.path.startsWith("/api/")) {
    return res.status(404).json({ error: "Endpoint not found" });
  }
  res.sendFile(path.join(__dirname, "..", "dashboard", "index.html"));
});

async function main(): Promise<void> {
  try {
    await prisma.$connect();
    console.log("[Server] Database connected");

    await initializeDefaultAlerts();

    await startIndexer();
    await storeMetricsSnapshot();

    const indexerCron = `*/${config.refresh.indexerIntervalSeconds} * * * * *`;
    cron.schedule(indexerCron, async () => {
      try {
        await indexNewEvents();
      } catch (error) {
        console.error("[Server] Indexer cron error:", error);
      }
    });

    const alertCronEveryMinute = "* * * * *";
    cron.schedule(alertCronEveryMinute, async () => {
      try {
        await checkAlerts();
      } catch (error) {
        console.error("[Server] Alert check cron error:", error);
      }
    });

    const metricsCron = "*/5 * * * *";
    cron.schedule(metricsCron, async () => {
      try {
        await storeMetricsSnapshot();
      } catch (error) {
        console.error("[Server] Metrics snapshot cron error:", error);
      }
    });

    console.log(`[Server] Indexer scheduled: every ${config.refresh.indexerIntervalSeconds}s`);
    console.log("[Server] Alert checker scheduled: every minute");
    console.log("[Server] Metrics snapshots scheduled: every 5 minutes");

    app.listen(config.server.port, () => {
      console.log(`[Server] Monitoring dashboard running on http://localhost:${config.server.port}`);
      console.log("[Server] API available at /api/*");
    });
  } catch (error) {
    console.error("[Server] Fatal error during startup:", error);
    await prisma.$disconnect();
    process.exit(1);
  }
}

process.on("SIGINT", async () => {
  console.log("[Server] Shutting down gracefully...");
  await prisma.$disconnect();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  console.log("[Server] Shutting down gracefully...");
  await prisma.$disconnect();
  process.exit(0);
});

process.on("unhandledRejection", (reason) => {
  console.error("[Server] Unhandled rejection:", reason);
});

process.on("uncaughtException", (error) => {
  console.error("[Server] Uncaught exception:", error);
  process.exit(1);
});

main();
