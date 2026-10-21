import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../src/app.js';
import { pingDatabase } from '../src/db/health-check.js';

// Replace the database ping with a fake we control. Tests never need a running Postgres.
vi.mock('../src/db/health-check.js', () => ({
  pingDatabase: vi.fn(),
}));

describe('GET /health', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks(); // put the real console.error back
  });

  it('returns 200 when the database answers', async () => {
    vi.mocked(pingDatabase).mockResolvedValue(undefined);

    const res = await request(app).get('/health');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok', database: 'connected' });
  });

  it('returns 500 when the database is unreachable', async () => {
    vi.mocked(pingDatabase).mockRejectedValue(new Error('connect ECONNREFUSED'));
    // The route logs the failure; silence it so the test output stays readable.
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await request(app).get('/health');

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ status: 'error', database: 'not connected' });
  });
});
