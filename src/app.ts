import express from 'express';
import { pingDatabase } from './db/health-check.js';
import { serviceRouter } from './routes/service-routes.js';
import { bodyParseErrorMiddleware } from './middlewares/body-parse-error-middleware.js';
import { errorMiddleware } from './middlewares/error-middleware.js';
import { notFoundMiddleware } from './middlewares/not-found-middleware.js';
import { asyncLocalStorage, requestLogMiddleware } from './middlewares/request-log.js';

export const app = express();

app.use(requestLogMiddleware);
app.use(express.json());
app.use(bodyParseErrorMiddleware);

app.use('/services', serviceRouter);

app.get('/health', async (_req, res) => {
  try {
    await pingDatabase();
    res.status(200).json({
      status: 'ok',
      database: 'connected',
    });
  } catch (err) {
    console.error('Health check failed: ', {
      error: err,
      request: asyncLocalStorage.getStore(),
    });
    res.status(500).json({
      status: 'error',
      database: 'not connected',
    });
  }
});

app.use(notFoundMiddleware);
app.use(errorMiddleware);
