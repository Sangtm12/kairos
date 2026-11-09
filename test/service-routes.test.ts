import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the data boundary: these tests cover validation, the service layer and HTTP mapping.
const { findAll, findById, insert, remove } = vi.hoisted(() => ({
  findAll: vi.fn(),
  findById: vi.fn(),
  insert: vi.fn(),
  remove: vi.fn(),
}));

vi.mock('../src/repositories/service-repository.js', () => ({
  findAll,
  findById,
  insert,
  remove,
  update: vi.fn(),
}));

import { app } from '../src/app.js';

const serviceId = '01a19ae4-3a54-7c1b-9298-d428ff4bca0f';
const providerId = '02a19ae4-3a54-7c1b-9298-d428ff4bca0f';
const service = {
  id: serviceId,
  providerId,
  title: 'Haircut',
  durationMinutes: 30,
  priceMinor: 1500,
  bufferBeforeMinutes: 0,
  bufferAfterMinutes: 0,
  createdAt: new Date('2026-11-01T00:00:00Z'),
  updatedAt: new Date('2026-11-02T00:00:00Z'),
};
const serviceJson = {
  ...service,
  createdAt: service.createdAt.toISOString(),
  updatedAt: service.updatedAt.toISOString(),
};
const validBody = { providerId, title: 'Haircut', durationMinutes: 30, priceMinor: 1500 };

beforeEach(() => vi.resetAllMocks());

describe('GET /services', () => {
  it('defaults to the first page of 10', async () => {
    findAll.mockResolvedValue([service]);

    const response = await request(app).get('/services');

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual([serviceJson]);
    expect(findAll).toHaveBeenCalledWith(1, 10);
  });

  it('coerces pagination from the query string', async () => {
    findAll.mockResolvedValue([]);

    const response = await request(app).get('/services?page=2&perPage=5');

    expect(response.status).toBe(200);
    expect(findAll).toHaveBeenCalledWith(2, 5);
  });

  it('rejects out-of-range pagination', async () => {
    const response = await request(app).get('/services?perPage=101');

    expect(response.status).toBe(422);
    expect(response.body.error.details).toEqual({ perPage: expect.any(String) });
    expect(findAll).not.toHaveBeenCalled();
  });
});

describe('GET /services/:serviceId', () => {
  it('returns the service', async () => {
    findById.mockResolvedValue(service);

    const response = await request(app).get(`/services/${serviceId}`);

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual(serviceJson);
  });

  it('returns 404 when the service does not exist', async () => {
    findById.mockResolvedValue(null);

    const response = await request(app).get(`/services/${serviceId}`);

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('NOT_FOUND_ERROR');
  });
});

describe('POST /services', () => {
  it('creates the service and returns 201', async () => {
    insert.mockResolvedValue(service);

    const response = await request(app).post('/services').send(validBody);

    expect(response.status).toBe(201);
    expect(response.body.data).toEqual(serviceJson);
    expect(insert).toHaveBeenCalledWith(validBody);
  });

  it.each([
    ['a float price', { priceMinor: 10.5 }, 'priceMinor'],
    ['a negative price', { priceMinor: -1 }, 'priceMinor'],
    ['a blank title', { title: '   ' }, 'title'],
    ['an oversized buffer', { bufferBeforeMinutes: 3_000_000_000 }, 'bufferBeforeMinutes'],
    ['an unknown field', { color: 'red' }, ''],
  ])('rejects %s with 422 before touching the database', async (_label, override, field) => {
    const response = await request(app)
      .post('/services')
      .send({ ...validBody, ...override });

    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    if (field) expect(response.body.error.details).toHaveProperty(field);
    expect(insert).not.toHaveBeenCalled();
  });

  it('returns 422 on providerId when the provider is missing or deleted', async () => {
    insert.mockResolvedValue(null);

    const response = await request(app).post('/services').send(validBody);

    expect(response.status).toBe(422);
    expect(response.body.error.details).toEqual({ providerId: 'Provider not found' });
  });
});

describe('DELETE /services/:serviceId', () => {
  it('soft-deletes and returns the service', async () => {
    remove.mockResolvedValue(service);

    const response = await request(app).delete(`/services/${serviceId}`);

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual(serviceJson);
    expect(remove).toHaveBeenCalledWith(serviceId);
  });

  it('returns 404 when the service does not exist or is already deleted', async () => {
    remove.mockResolvedValue(null);

    const response = await request(app).delete(`/services/${serviceId}`);

    expect(response.status).toBe(404);
  });
});
