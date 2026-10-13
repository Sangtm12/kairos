import express from 'express';
import { pool } from './config/db.js';

const app = express();
const port = Number(process.env.PORT ?? 3000);

app.use(express.json());

app.get('/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.status(200).json({
      status: 'ok',
      database: 'connected',
    });
  } catch {
    res.status(500).json({
      status: 'error',
      database: 'not connected',
    });
  }
});

const startServer = async () => {
  try {
    const { rows } = await pool.query<{ now: string }>('SELECT NOW()');
    console.log(`database connected: ${rows[0]?.now}`);

    const server = app.listen(port, () => {
      console.log(`Server listening on port ${port}`);
    });

    //graceful shutdown
    const gracefulShutdown = (reason: string) => {
      console.log(`Gracefully shutting down. Reason: `, reason);

      server.close(() => {
        console.log('HTTP server closed.');
        pool
          .end()
          .then(() => {
            console.log('Database pool closed.');
            process.exit(0);
          })
          .catch((err) => {
            console.log(`Error closing database pool: `, err);
            process.exit(1);
          });
      });
    };

    process.on('SIGTERM', gracefulShutdown);
    process.on('SIGINT', gracefulShutdown);

    //exit with error
    process.on('uncaughtException', (error) => {
      console.error('CRITICAL: Uncaught Exception! Shutting down immediately.', error);
      // Optional: Add emergency logging or cleanup here if synchronous
      process.exit(1); // Force exit; let your process manager (Docker/PM2) restart it
    });

    process.on('unhandledRejection', (reason, promise) => {
      console.error('CRITICAL: Unhandled Promise Rejection! Shutting down immediately.', {
        promise,
        reason,
      });
      process.exit(1); // Force exit
    });
  } catch (err) {
    console.error('Error connecting to database: ', err);
    process.exit(1);
  }
};

void startServer();
