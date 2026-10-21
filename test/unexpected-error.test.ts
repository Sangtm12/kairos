import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { app } from '../src/app.js';
import { findAll } from '../src/repositories/service-repository.js';

// Swap the data layer for a fake so we can make it fail on demand.
vi.mock('../src/repositories/service-repository.js', () => ({
  findAll: vi.fn(),
}));

describe('unexpected errors', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns a generic 500 without leaking internals', async () => {
    vi.mocked(findAll).mockRejectedValue(new Error('boom: secret internal detail'));
    // errorMiddleware logs unknown errors; silence it so the test output stays readable.
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await request(app).get('/services');

    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_SERVER_ERROR');

    // The client must never see the original message or a stack trace.
    const body = JSON.stringify(res.body);
    expect(body).not.toContain('boom');
    expect(body).not.toContain('stack');
  });
});
