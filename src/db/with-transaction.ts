import type { PoolClient } from 'pg';
import { pool } from './client.js';

export const withTransaction = async <T>(callback: (client: PoolClient) => Promise<T>) => {
  const client = await pool.connect();
  let shouldDiscardConnection = false;

  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackErr) {
      shouldDiscardConnection = true;
      console.error('Rollback failed', rollbackErr);
    }
    throw error;
  } finally {
    client.release(shouldDiscardConnection);
  }
};
