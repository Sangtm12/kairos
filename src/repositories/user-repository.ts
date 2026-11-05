import type { Pool, PoolClient } from 'pg';
import { pool } from '../db/client.js';
import type { User, UserRoleEnum } from '../domain/user.js';

type UserRow = {
  id: string;
  email: string;
  created_at: Date;
  updated_at: Date;
  role: UserRoleEnum;
};

const mapUserRow = (row: UserRow): User => ({
  id: row.id,
  email: row.email,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  role: row.role,
});

export const findById = async (userId: string): Promise<User | null> => {
  const { rows } = await pool.query<UserRow>(
    `SELECT id, email, created_at, updated_at, role 
    FROM users 
    WHERE id = $1 
    AND deleted_at IS NULL`,
    [userId],
  );
  return rows[0] ? mapUserRow(rows[0]) : null;
};

export const findByEmail = async (email: string): Promise<User | null> => {
  const { rows } = await pool.query<UserRow>(
    `SELECT id, email, created_at, updated_at, role 
    FROM users 
    WHERE email = $1 
    AND deleted_at IS NULL`,
    [email],
  );
  return rows[0] ? mapUserRow(rows[0]) : null;
};

export const create = async (
  email: string,
  passwordHash: string,
  client: PoolClient | Pool = pool,
) => {
  const { rows } = await client.query<UserRow>(
    `
    INSERT INTO users (email, password_hash, role)
    VALUES ($1, $2, 'customer')
    RETURNING id, email, role, created_at, updated_at`,
    [email, passwordHash],
  );

  return mapUserRow(rows[0]!);
};
