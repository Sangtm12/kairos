import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { app } from '../src/app.js';

describe('malformed JSON body', () => {
  it('returns 400 when the JSON body cannot be parsed', async () => {
    // No POST /services route exists: express.json() rejects the body before routing.
    const res = await request(app)
      .post('/services')
      .set('Content-Type', 'application/json')
      .send('{bad');

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('BAD_REQUEST_ERROR');
  });
});
