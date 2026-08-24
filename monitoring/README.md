# StellarStream Monitoring Dashboard

Real-time monitoring for StellarStream Soroban smart contracts on the Stellar network.

## Prerequisites

- Node.js 18+ and npm
- SQLite (bundled with Prisma, no separate install needed)
- Stellar testnet access (or mainnet URL)

## Quick Start

```bash
# Clone and install
cd monitoring
npm install

# Configure environment
cp .env.example .env
# Edit .env with your contract IDs and settings

# Initialize database
npx prisma migrate dev --name init
npx prisma generate

# Start development server
npm run dev
```

Open `http://localhost:3456` in your browser.

## Configuration

Edit `.env` with your values:

| Variable | Description | Default |
|---|---|---|
| `STELLAR_NETWORK_URL` | Stellar RPC/Soroban endpoint | `https://soroban-testnet.stellar.org` |
| `STELLAR_PASSPHRASE` | Network passphrase | `Test SDF Network ; September 2015` |
| `CONTRACT_ID_SPLITTER` | Splitter contract address | (empty) |
| `CONTRACT_ID_STREAM_V1` | Stream V1 contract address | (empty) |
| `CONTRACT_ID_STREAM_V2` | Stream V2 contract address | (empty) |
| `PORT` | Server port | `3456` |
| `DATABASE_URL` | SQLite database path | `file:./dev.db` |
| `ALERT_WEBHOOK_URL` | Default webhook URL for alerts | (empty) |
| `REFRESH_INTERVAL_SECONDS` | Event indexer poll interval | `5` |
| `ALERT_CHECK_INTERVAL_SECONDS` | Alert check interval | `60` |

## Production Build

```bash
npm run build
npm run start
```

## Docker

```bash
# Build and run
docker compose up -d

# View logs
docker compose logs -f

# Stop
docker compose down
```

## Architecture

```
monitoring/
├── prisma/
│   └── schema.prisma          # Database models
├── src/
│   ├── config.ts              # Environment configuration
│   ├── indexer.ts              # Stellar event indexer
│   ├── metrics.ts              # Metrics computation
│   ├── alerts.ts               # Alert system
│   ├── dashboard.ts            # Express API routes
│   └── server.ts               # Entry point
├── dashboard/
│   └── index.html              # Single-page dashboard UI
├── Dockerfile                  # Multi-stage Docker build
├── docker-compose.yml          # Docker Compose setup
└── package.json
```

### Components

**Event Indexer** (`src/indexer.ts`)
- Connects to Stellar RPC and polls for new ledger events every 5 seconds
- Parses contract events (splitexec, paysent, indivpay, sched, cancel, claimed, affiliate, admprop, setstate, verified)
- Stores events in the `RecentActivity` table
- Tracks user transaction volumes

**Metrics Engine** (`src/metrics.ts`)
- Computes TVL from on-chain contract data
- Counts active and total streams
- Aggregates gas cost statistics per operation type
- Tracks error rates across time windows

**Alert System** (`src/alerts.ts`)
- Configurable thresholds for any metric
- Fires webhooks to Discord, Slack, or custom endpoints
- Rate-limited: max 1 alert per metric per hour
- Records all alert firings in history

**API Dashboard** (`src/dashboard.ts`)
- REST API serving all dashboard data
- Paginated endpoints with filtering
- Health check endpoint

## Adding New Event Parsers

In `src/indexer.ts`, update the `classifyEvent` function to handle new event types:

```typescript
function classifyEvent(type: string): EventType {
  const lower = type.toLowerCase();
  // Add new event types here:
  if (lower.includes("my_new_event")) return EVENT_TYPES.MY_NEW_EVENT;
  // ... existing cases
}
```

Then add the new type to `EVENT_TYPES` in `src/config.ts`:

```typescript
export const EVENT_TYPES = {
  // ... existing types
  MY_NEW_EVENT: "my_new_event",
} as const;
```

## Configuring Alerts

### Via Dashboard UI

1. Open the dashboard at `http://localhost:3456`
2. Scroll to "Alert Configuration"
3. Click "+ Add Alert"
4. Select metric, direction, and threshold
5. Optionally provide a webhook URL

### Supported Metrics

| Metric | Description |
|---|---|
| `tvl` | Total value locked across contracts |
| `active_streams` | Number of active streams |
| `error_rate` | Errors per 100 events |
| `error_count_24h` | Total errors in last 24 hours |
| `gas_cost` | Average gas cost per operation |
| `total_streams` | Total streams ever created |

### Webhook Format

**Discord** — uses rich embeds automatically when a Discord webhook URL is detected.

**Slack** — uses Slack attachment format when a Slack webhook URL is detected.

**Custom** — sends a JSON payload:
```json
{
  "alert": true,
  "metric": "tvl",
  "message": "Alert: tvl dropped below threshold...",
  "currentValue": 1500.50,
  "threshold": 2000,
  "direction": "below",
  "timestamp": "2026-08-19T12:00:00.000Z"
}
```

## API Endpoints

| Method | Path | Description |
|---|---|---|
| GET | `/api/overview` | TVL, active streams, total streams, error rate |
| GET | `/api/activity` | Recent transactions (paginated, filterable) |
| GET | `/api/gas-stats` | Gas cost statistics per operation |
| GET | `/api/errors` | Error logs (paginated) |
| GET | `/api/top-users` | Top users by volume |
| GET | `/api/admin-operations` | Admin operations log |
| GET | `/api/alerts/history` | Alert firing history |
| GET | `/api/alerts/config` | Alert configurations |
| POST | `/api/alerts/config` | Create alert config |
| PUT | `/api/alerts/config/:id` | Update alert config |
| DELETE | `/api/alerts/config/:id` | Delete alert config |
| GET | `/api/health` | Service health check |
