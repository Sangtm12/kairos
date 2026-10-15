import { Pool } from 'pg';

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT ? parseInt(process.env.DB_PORT, 10) : 5432,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});

// A pooled client can die without the app doing anything wrong: Postgres
// restarting, a network blip, an idle timeout. pg surfaces that on the pool's
// 'error' event, and an EventEmitter with no 'error' listener *throws* — which
// would take the whole process down over a blip the pool recovers from on its own.
pool.on('error', (err) => {
  console.error('Idle database client error (pool will reconnect): ', err);
});

export { pool };
