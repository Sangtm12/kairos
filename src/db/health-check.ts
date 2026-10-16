import { pool } from './client.js';

export const pingDatabase = async () => {
  await pool.query('SELECT 1');
};
