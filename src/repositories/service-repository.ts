import { pool } from '../db/client.js';
import type { Service } from '../domain/service.js';

type ServiceRow = {
  id: string;
  provider_id: string;
  title: string;
  duration_minutes: number;
  price_minor: string;
  buffer_before_minutes: number;
  buffer_after_minutes: number;
  created_at: Date;
  updated_at: Date;
};

const mapServiceRow = (row: ServiceRow): Service => ({
  id: row.id,
  providerId: row.provider_id,
  title: row.title,
  durationMinutes: row.duration_minutes,
  priceMinor: Number(row.price_minor),
  bufferAfterMinutes: row.buffer_after_minutes,
  bufferBeforeMinutes: row.buffer_before_minutes,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export const findAll = async (perPage: number = 10, page: number = 1): Promise<Service[]> => {
  const { rows } = await pool.query<ServiceRow>(
    `
    SELECT id, provider_id, title, duration_minutes, price_minor, buffer_before_minutes, buffer_after_minutes, created_at, updated_at
    FROM services
    WHERE deleted_at IS NULL
    ORDER BY created_at DESC
    LIMIT $1 
    OFFSET $2
    `,
    [perPage, perPage * (page - 1)],
  );
  return rows.map(mapServiceRow);
};
