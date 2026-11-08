import { pool } from '../db/client.js';
import type { Service } from '../domain/service.js';
import type { CreateServiceBody, UpdateServiceBody } from '../validators/service-validator.js';

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

export const insert = async (service: CreateServiceBody): Promise<Service> => {
  const { rows } = await pool.query<ServiceRow>(
    `
    INSERT INTO services (provider_id, title, duration_minutes, price_minor, buffer_before_minutes, buffer_after_minutes)
    VALUES ($1, $2, $3, $4, $5, $6)
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

  return mapServiceRow(rows[0]!);
};

export const update = async (
  serviceId: string,
  service: UpdateServiceBody,
): Promise<Service | null> => {
  const fields: [keyof UpdateServiceBody, string][] = [
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
    DELETE FROM services
    WHERE id = $1
    RETURNING id, provider_id, title, duration_minutes, price_minor, buffer_before_minutes, buffer_after_minutes, created_at, updated_at  
  `,
    [serviceId],
  );

  return rows[0] ? mapServiceRow(rows[0]) : null;
};
