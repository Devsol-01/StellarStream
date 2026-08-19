import { PrismaClient, AlertConfig, AlertHistory } from "@prisma/client";
import { config } from "./config";

const prisma = new PrismaClient();

interface AlertPayload {
  metric: string;
  currentValue: number;
  threshold: number;
  direction: string;
  message: string;
  timestamp: string;
}

async function getActiveAlertConfigs(): Promise<AlertConfig[]> {
  return prisma.alertConfig.findMany({
    where: { enabled: true },
  });
}

async function wasRecentlyFired(
  alertConfigId: string
): Promise<boolean> {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

  const recentFiring = await prisma.alertHistory.findFirst({
    where: {
      alertConfigId,
      firedAt: { gte: oneHourAgo },
    },
  });

  return recentFiring !== null;
}

async function shouldAlert(
  config: AlertConfig,
  currentValue: number
): Promise<boolean> {
  const alreadyFired = await wasRecentlyFired(config.id);
  if (alreadyFired) return false;

  switch (config.direction) {
    case "below":
      return currentValue < config.threshold;
    case "above":
      return currentValue > config.threshold;
    case "equals":
      return currentValue === config.threshold;
    default:
      return false;
  }
}

async function sendWebhook(payload: AlertPayload, webhookUrl?: string): Promise<boolean> {
  const url = webhookUrl || config.alerts.webhookUrl;

  if (!url) {
    console.log(`[Alerts] No webhook URL configured, alert not sent: ${payload.message}`);
    return false;
  }

  try {
    const isDiscord = url.includes("discord.com");
    const isSlack = url.includes("hooks.slack.com");

    let body: string;

    if (isDiscord) {
      body = JSON.stringify({
        embeds: [
          {
            title: `StellarStream Alert: ${payload.metric}`,
            description: payload.message,
            color: 0xff4444,
            fields: [
              { name: "Current Value", value: payload.currentValue.toLocaleString(), inline: true },
              { name: "Threshold", value: payload.threshold.toLocaleString(), inline: true },
              { name: "Direction", value: payload.direction, inline: true },
            ],
            timestamp: payload.timestamp,
          },
        ],
      });
    } else if (isSlack) {
      body = JSON.stringify({
        text: `StellarStream Alert`,
        attachments: [
          {
            color: "#ff4444",
            title: `Alert: ${payload.metric}`,
            text: payload.message,
            fields: [
              { title: "Current Value", value: String(payload.currentValue), short: true },
              { title: "Threshold", value: String(payload.threshold), short: true },
              { title: "Direction", value: payload.direction, short: true },
            ],
            ts: Math.floor(Date.now() / 1000),
          },
        ],
      });
    } else {
      body = JSON.stringify({
        alert: true,
        metric: payload.metric,
        message: payload.message,
        currentValue: payload.currentValue,
        threshold: payload.threshold,
        direction: payload.direction,
        timestamp: payload.timestamp,
      });
    }

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });

    if (!response.ok) {
      console.error(`[Alerts] Webhook returned ${response.status}: ${response.statusText}`);
      return false;
    }

    console.log(`[Alerts] Webhook sent successfully for ${payload.metric}`);
    return true;
  } catch (error) {
    console.error("[Alerts] Error sending webhook:", error);
    return false;
  }
}

async function recordFiring(
  alertConfigId: string,
  payload: AlertPayload
): Promise<void> {
  try {
    await prisma.alertHistory.create({
      data: {
        alertConfigId,
        message: payload.message,
        value: payload.currentValue,
        threshold: payload.threshold,
        firedAt: new Date(),
      },
    });
  } catch (error) {
    console.error("[Alerts] Error recording firing:", error);
  }
}

async function getMetricValue(metric: string): Promise<number | null> {
  switch (metric) {
    case "tvl": {
      const metrics = await prisma.streamMetrics.findFirst({
        orderBy: { timestamp: "desc" },
      });
      return metrics?.totalValueLocked ?? 0;
    }
    case "active_streams": {
      const metrics = await prisma.streamMetrics.findFirst({
        orderBy: { timestamp: "desc" },
      });
      return metrics?.activeStreams ?? 0;
    }
    case "error_rate": {
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
      return prisma.errorLog.count({
        where: { timestamp: { gte: oneHourAgo } },
      });
    }
    case "error_count_24h": {
      const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      return prisma.errorLog.count({
        where: { timestamp: { gte: twentyFourHoursAgo } },
      });
    }
    case "gas_cost": {
      const stats = await prisma.gasCostStats.findFirst({
        orderBy: { avgGasCost: "desc" },
      });
      return stats?.avgGasCost ?? 0;
    }
    case "total_streams": {
      const metrics = await prisma.streamMetrics.findFirst({
        orderBy: { timestamp: "desc" },
      });
      return metrics?.totalStreamsCreated ?? 0;
    }
    default:
      return null;
  }
}

export async function checkAlerts(): Promise<void> {
  try {
    const alertConfigs = await getActiveAlertConfigs();

    if (alertConfigs.length === 0) {
      return;
    }

    console.log(`[Alerts] Checking ${alertConfigs.length} alert configurations`);

    for (const alertConfig of alertConfigs) {
      const currentValue = await getMetricValue(alertConfig.metric);
      if (currentValue === null) {
        console.warn(`[Alerts] Unknown metric: ${alertConfig.metric}`);
        continue;
      }

      const shouldFire = await shouldAlert(alertConfig, currentValue);

      if (shouldFire) {
        const directionLabel =
          alertConfig.direction === "below" ? "dropped below" : "exceeded";

        const payload: AlertPayload = {
          metric: alertConfig.metric,
          currentValue,
          threshold: alertConfig.threshold,
          direction: alertConfig.direction,
          message: `Alert: ${alertConfig.metric} ${directionLabel} threshold. Current: ${currentValue}, Threshold: ${alertConfig.threshold}`,
          timestamp: new Date().toISOString(),
        };

        const sent = await sendWebhook(payload, alertConfig.webhookUrl || undefined);

        await recordFiring(alertConfig.id, payload);

        if (sent) {
          console.log(`[Alerts] Fired alert for ${alertConfig.metric}: ${payload.message}`);
        }
      }
    }
  } catch (error) {
    console.error("[Alerts] Error during alert check:", error);
  }
}

export async function createAlertConfig(
  metric: string,
  threshold: number,
  direction: string,
  webhookUrl?: string
): Promise<AlertConfig> {
  return prisma.alertConfig.create({
    data: {
      metric,
      threshold,
      direction,
      enabled: true,
      webhookUrl: webhookUrl || "",
    },
  });
}

export async function updateAlertConfig(
  id: string,
  data: Partial<Pick<AlertConfig, "metric" | "threshold" | "direction" | "enabled" | "webhookUrl">>
): Promise<AlertConfig> {
  return prisma.alertConfig.update({
    where: { id },
    data,
  });
}

export async function deleteAlertConfig(id: string): Promise<void> {
  await prisma.alertConfig.delete({ where: { id } });
}

export async function getAlertHistory(limit: number = 50): Promise<AlertHistory[]> {
  return prisma.alertHistory.findMany({
    orderBy: { firedAt: "desc" },
    take: limit,
  });
}

export async function getAlertConfigs(): Promise<AlertConfig[]> {
  return prisma.alertConfig.findMany();
}

export async function initializeDefaultAlerts(): Promise<void> {
  const existingCount = await prisma.alertConfig.count();
  if (existingCount > 0) return;

  const defaults = [
    {
      metric: "tvl",
      threshold: config.alerts.tvlDropPercentThreshold,
      direction: "below",
    },
    {
      metric: "error_rate",
      threshold: config.alerts.errorRateThreshold,
      direction: "above",
    },
    {
      metric: "error_count_24h",
      threshold: 50,
      direction: "above",
    },
  ];

  for (const def of defaults) {
    await prisma.alertConfig.create({
      data: {
        metric: def.metric,
        threshold: def.threshold,
        direction: def.direction,
        enabled: true,
        webhookUrl: config.alerts.webhookUrl,
      },
    });
  }

  console.log("[Alerts] Initialized default alert configurations");
}
