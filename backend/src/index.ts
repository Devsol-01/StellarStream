import express, { Express, Request, Response } from 'express';
import batchRoutes from './api/routes.js';

const app: Express = express();
const PORT = process.env.PORT ?? 3000;

app.use(express.json());

app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', message: 'StellarStream Backend is running' });
});

// Batch metadata endpoint for bulk streaming queries
app.use(batchRoutes);

app.listen(PORT, () => {
  console.log(`🚀 Server is running on port ${PORT}`);
});

export default app;
