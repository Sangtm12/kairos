import express from 'express';
import { pingDatabase } from './db/health-check.js';
import { serviceRouter } from './routes/service-routes.js';
import { errorMiddleware } from './middlewares/error-middleware.js';

export const app = express();

app.use(express.json());

app.use('/services', serviceRouter);

app.get('/health', async (_req, res) => {
  try {
    await pingDatabase();
    res.status(200).json({
      status: 'ok',
      database: 'connected',
    });
  } catch (err) {
    console.error('Health check failed: ', err);
    res.status(500).json({
      status: 'error',
      database: 'not connected',
    });
  }
});

app.use(errorMiddleware);
