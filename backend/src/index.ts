import express, { Express, Request, Response } from 'express';
import { authMiddleware } from './middleware/auth.js';
import { rateLimitMiddleware } from './middleware/rateLimit.js';
import { requireWalletAuth } from './middleware/requireWalletAuth.js';
import { getStats, getSearch } from './api/public.js';
import { getNonce, getMe } from './api/auth.js';
import { ensureRedis, closeRedis } from './lib/redis.js';
import { prisma } from './lib/db.js';

const app: Express = express();
const PORT = process.env.PORT ?? 3000;

app.use(express.json());
app.use(authMiddleware);

app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', message: 'StellarStream Backend is running' });
});

app.get('/stats', rateLimitMiddleware, getStats);
app.get('/search', rateLimitMiddleware, getSearch);

const authRouter = express.Router();
authRouter.get('/nonce', rateLimitMiddleware, getNonce);
authRouter.get('/me', rateLimitMiddleware, requireWalletAuth, getMe);
app.use('/api/v1/auth', authRouter);

async function start(): Promise<void> {
  await ensureRedis();
  app.listen(PORT, () => {
    console.log(`🚀 Server is running on port ${PORT}`);
  });
}

function shutdown(signal: string): void {
  console.log(`${signal} received, shutting down gracefully...`);
  closeRedis()
    .then(() => prisma.$disconnect())
    .then(() => {
      console.log('Goodbye.');
      process.exit(0);
    })
    .catch((err) => {
      console.error('Shutdown error:', err);
      process.exit(1);
    });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

start().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});

export default app;
