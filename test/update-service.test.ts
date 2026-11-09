import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { update } = vi.hoisted(() => ({
  update: vi.fn(),
}));

vi.mock('../src/repositories/service-repository.js', () => ({
  findAll: vi.fn(),
  findById: vi.fn(),
  insert: vi.fn(),
  remove: vi.fn(),
  update,
}));

import { app } from '../src/app.js';

const serviceId = '01a19ae4-3a54-7c1b-9298-d428ff4bca0f';
const service = {
  id: serviceId,
  providerId: '02a19ae4-3a54-7c1b-9298-d428ff4bca0f',
  title: 'Updated service',
  durationMinutes: 30,
  priceMinor: 1500,
  bufferBeforeMinutes: 0,
  bufferAfterMinutes: 0,
  createdAt: new Date('2026-11-01T00:00:00Z'),
  updatedAt: new Date('2026-11-02T00:00:00Z'),
};

describe('PATCH /services/:serviceId', () => {
  beforeEach(() => vi.resetAllMocks());

  it('validates params and body, updates the service, and returns it', async () => {
    update.mockResolvedValue(service);

    const response = await request(app)
      .patch(`/services/${serviceId}`)
      .send({ title: 'Updated service' });

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({
      ...service,
      createdAt: service.createdAt.toISOString(),
      updatedAt: service.updatedAt.toISOString(),
    });
    expect(update).toHaveBeenCalledWith(serviceId, { title: 'Updated service' });
  });

  it('rejects invalid service IDs and empty patches before updating', async () => {
    const invalidIdResponse = await request(app)
      .patch('/services/not-a-uuid')
      .send({ title: 'Valid' });
    const emptyBodyResponse = await request(app).patch(`/services/${serviceId}`).send({});

    expect(invalidIdResponse.status).toBe(422);
    expect(emptyBodyResponse.status).toBe(422);
    expect(update).not.toHaveBeenCalled();
  });

  it('reports field errors as { field: message } and object-level errors as the message', async () => {
    const emptyBody = await request(app).patch(`/services/${serviceId}`).send({});
    const floatPrice = await request(app)
      .patch(`/services/${serviceId}`)
      .send({ priceMinor: 10.5 });

    expect(emptyBody.body.error.message).toBe('At least one service field must be provided');
    expect(emptyBody.body.error.details).toEqual({});
    expect(floatPrice.status).toBe(422);
    expect(floatPrice.body.error.details).toEqual({ priceMinor: expect.any(String) });
  });

  it('returns 404 if the service does not exist', async () => {
    update.mockResolvedValue(null);

    const response = await request(app)
      .patch(`/services/${serviceId}`)
      .send({ title: 'Updated service' });

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('NOT_FOUND_ERROR');
  });
});
