import type { PoolClient } from 'pg';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pool } from '../src/db/client.js';
import { withTransaction } from '../src/db/with-transaction.js';

// Replace the pool with a fake we control. Tests never need a running Postgres.
vi.mock('../src/db/client.js', () => ({
  pool: { connect: vi.fn() },
}));

describe('withTransaction', () => {
  let client: { query: ReturnType<typeof vi.fn>; release: ReturnType<typeof vi.fn> };

  // The SQL statements the transaction sent, in order.
  const sentStatements = () => client.query.mock.calls.map(([sql]) => sql);

  beforeEach(() => {
    vi.resetAllMocks();
    client = { query: vi.fn().mockResolvedValue({ rows: [] }), release: vi.fn() };
    vi.mocked(pool.connect).mockResolvedValue(client as unknown as PoolClient as never);
  });

  afterEach(() => {
    vi.restoreAllMocks(); // put the real console methods back
  });

  it('commits and returns the callback result', async () => {
    const result = await withTransaction(async (tx) => {
      await tx.query('INSERT INTO users (email) VALUES ($1)', ['a@b.c']);
      return 'done';
    });

    expect(result).toBe('done');
    expect(sentStatements()).toEqual(['BEGIN', 'INSERT INTO users (email) VALUES ($1)', 'COMMIT']);
    expect(client.release).toHaveBeenCalledExactlyOnceWith(false);
  });

  it('rolls back and rethrows when the callback throws mid-transaction', async () => {
    const failure = new Error('boom');

    await expect(
      withTransaction(async (tx) => {
        await tx.query('INSERT INTO users (email) VALUES ($1)', ['a@b.c']);
        throw failure;
      }),
    ).rejects.toBe(failure);

    expect(sentStatements()).toEqual([
      'BEGIN',
      'INSERT INTO users (email) VALUES ($1)',
      'ROLLBACK',
    ]);
    expect(sentStatements()).not.toContain('COMMIT');
    // Rollback succeeded, so the connection is healthy and goes back to the pool.
    expect(client.release).toHaveBeenCalledExactlyOnceWith(false);
  });

  it('rethrows the original error and discards the connection when ROLLBACK fails', async () => {
    const failure = new Error('boom');
    client.query.mockImplementation(async (sql: string) => {
      if (sql === 'ROLLBACK') throw new Error('connection terminated');
      return { rows: [] };
    });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(
      withTransaction(async () => {
        throw failure;
      }),
    ).rejects.toBe(failure);

    // A client whose ROLLBACK failed is in an unknown state: destroy it, don't reuse it.
    expect(client.release).toHaveBeenCalledExactlyOnceWith(true);
  });

  it('releases the connection when BEGIN itself fails', async () => {
    client.query.mockRejectedValueOnce(new Error('cannot begin'));

    await expect(withTransaction(async () => 'never')).rejects.toThrow('cannot begin');

    expect(client.release).toHaveBeenCalledOnce();
  });
});
