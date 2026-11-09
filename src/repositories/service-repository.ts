import { pool } from '../db/client.js';
import type { NewService, Service, ServiceChanges } from '../domain/service.js';

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

export const findAll = async (page: number = 1, perPage: number = 10): Promise<Service[]> => {
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

export const findById = async (serviceId: string): Promise<Service | null> => {
  const { rows } = await pool.query<ServiceRow>(
    `
    SELECT id, provider_id, title, duration_minutes, price_minor, buffer_before_minutes, buffer_after_minutes, created_at, updated_at
    FROM services
    WHERE deleted_at IS NULL
    AND id = $1
    `,
    [serviceId],
  );

  return rows[0] ? mapServiceRow(rows[0]) : null;
};

export const insert = async (service: NewService): Promise<Service | null> => {
  const { rows } = await pool.query<ServiceRow>(
    `
    INSERT INTO services (provider_id, title, duration_minutes, price_minor, buffer_before_minutes, buffer_after_minutes)
    SELECT p.id, $2, $3, $4, $5, $6
    FROM provider_profiles p
    WHERE p.id = $1
    AND p.deleted_at IS NULL
    RETURNING id, provider_id, title, duration_minutes, price_minor, buffer_before_minutes, buffer_after_minutes, created_at, updated_at
    `,
    [
      service.providerId,
      service.title,
      service.durationMinutes,
      service.priceMinor,
      service.bufferBeforeMinutes ?? 0,
      service.bufferAfterMinutes ?? 0,
    ],
  );

  return rows[0] ? mapServiceRow(rows[0]) : null;
};

export const update = async (
  serviceId: string,
  service: ServiceChanges,
): Promise<Service | null> => {
  const fields: [keyof ServiceChanges, string][] = [
    ['title', 'title'],
    ['durationMinutes', 'duration_minutes'],
    ['priceMinor', 'price_minor'],
    ['bufferBeforeMinutes', 'buffer_before_minutes'],
    ['bufferAfterMinutes', 'buffer_after_minutes'],
  ];
  const values: unknown[] = [serviceId];
  const assignments = fields.flatMap(([field, column]) => {
    const value = service[field];
    if (value === undefined) return [];
    values.push(value);
    return [`${column} = $${values.length}`];
  });

  assignments.push('updated_at = NOW()');

  const { rows } = await pool.query<ServiceRow>(
    `
    UPDATE services
    SET ${assignments.join(', ')}
    WHERE id = $1
      AND deleted_at IS NULL
    RETURNING id, provider_id, title, duration_minutes, price_minor, buffer_before_minutes, buffer_after_minutes, created_at, updated_at
  `,
    values,
  );

  return rows[0] ? mapServiceRow(rows[0]) : null;
};

export const remove = async (serviceId: string): Promise<Service | null> => {
  const { rows } = await pool.query<ServiceRow>(
    `
    UPDATE services
    SET deleted_at = NOW()
    WHERE id = $1
    AND deleted_at IS NULL
    RETURNING id, provider_id, title, duration_minutes, price_minor, buffer_before_minutes, buffer_after_minutes, created_at, updated_at  
  `,
    [serviceId],
  );

  return rows[0] ? mapServiceRow(rows[0]) : null;
};
