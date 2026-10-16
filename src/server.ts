import express from 'express';
import { pool } from './db/db.js';
import { config } from './config/env.js';

const app = express();
const port = config.port;

// Registered at module scope, not inside startServer: a throw during startup —
// before the database is even reached — must still be logged rather than vanish.
process.on('uncaughtException', (error) => {
  console.error('CRITICAL: Uncaught Exception! Shutting down immediately.', error);
  process.exit(1); // Force exit; let the process manager restart us.
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('CRITICAL: Unhandled Promise Rejection! Shutting down immediately.', {
    promise,
    reason,
  });
  process.exit(1);
});

app.use(express.json());

app.get('/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
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

// Docker sends SIGKILL 10s after SIGTERM, so cap our own attempt below that.
const SHUTDOWN_TIMEOUT_MS = 8000;

const startServer = async () => {
  try {
    // pg parses timestamptz into a JS Date, not a string.
    const { rows } = await pool.query<{ now: Date }>('SELECT NOW()');
    console.log(`database connected: ${rows[0]?.now.toISOString() ?? 'unknown'}`);

    const server = app.listen(port, () => {
      console.log(`Server listening on port ${port}`);
    });

    //graceful shutdown
    let shuttingDown = false;
    const gracefulShutdown = (reason: string) => {
      // A second Ctrl-C would otherwise call pool.end() twice, which rejects.
      if (shuttingDown) return;
      shuttingDown = true;

      console.log(`Gracefully shutting down. Reason: `, reason);

      // server.close() waits for every open connection to end, and a single
      // idle keep-alive socket can hold it open forever. Hang up on the idle
      // ones now, and put a hard ceiling on waiting for the in-flight ones.
      const forceExit = setTimeout(() => {
        console.error(`Shutdown timed out after ${SHUTDOWN_TIMEOUT_MS}ms. Forcing exit.`);
        process.exit(1);
      }, SHUTDOWN_TIMEOUT_MS);
      forceExit.unref();

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
      server.closeIdleConnections();
    };

    process.on('SIGTERM', gracefulShutdown);
    process.on('SIGINT', gracefulShutdown);
  } catch (err) {
    console.error('Error connecting to database: ', err);
    process.exit(1);
  }
};

void startServer();
