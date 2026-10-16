import { Pool } from 'pg';
import { config } from '../config/env.js';

const pool = new Pool({
  host: config.dbHost,
  port: config.dbPort,
  user: config.dbUser,
  password: config.dbPassword,
  database: config.dbName,
});

// A pooled client can die without the app doing anything wrong: Postgres
// restarting, a network blip, an idle timeout. pg surfaces that on the pool's
// 'error' event, and an EventEmitter with no 'error' listener *throws* — which
// would take the whole process down over a blip the pool recovers from on its own.
pool.on('error', (err) => {
  console.error('Idle database client error (pool will reconnect): ', err);
});

export { pool };
