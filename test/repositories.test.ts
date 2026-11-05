import type { Pool } from 'pg';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { pool } from '../src/db/client.js';
import * as serviceRepository from '../src/repositories/service-repository.js';
import * as userRepository from '../src/repositories/user-repository.js';

// Replace the pool with a fake we control. Tests never need a running Postgres.
vi.mock('../src/db/client.js', () => ({
  pool: { query: vi.fn() },
}));

const createdAt = new Date('2026-11-01T00:00:00Z');
const updatedAt = new Date('2026-11-02T00:00:00Z');

const userRow = {
  id: '01a19ae4-3a54-7c1b-9298-d428ff4bca0f',
  email: 'jane@example.com',
  role: 'customer',
  created_at: createdAt,
  updated_at: updatedAt,
};

const expectedUser = {
  id: userRow.id,
  email: userRow.email,
  role: 'customer',
  createdAt,
  updatedAt,
};

const queryMock = () => vi.mocked(pool.query) as unknown as ReturnType<typeof vi.fn>;

// The parameterized-query contract: values travel separately, never inside the SQL text.
const expectParameterized = (sql: string, params: unknown[]) => {
  params.forEach((_, i) => expect(sql).toContain(`$${i + 1}`));
  expect(sql).not.toContain('${');
};

describe('serviceRepository.findAll', () => {
  beforeEach(() => vi.resetAllMocks());

  it('maps snake_case rows to Service domain objects', async () => {
    queryMock().mockResolvedValue({
      rows: [
        {
          id: 'svc-1',
          provider_id: 'prov-1',
          title: 'Haircut',
          duration_minutes: 45,
          price_minor: '200000', // pg returns BIGINT as a string
          buffer_before_minutes: 15,
          buffer_after_minutes: 5,
          created_at: createdAt,
          updated_at: updatedAt,
        },
      ],
    });

    const services = await serviceRepository.findAll();

    expect(services).toEqual([
      {
        id: 'svc-1',
        providerId: 'prov-1',
        title: 'Haircut',
        durationMinutes: 45,
        priceMinor: 200000,
        bufferBeforeMinutes: 15,
        bufferAfterMinutes: 5,
        createdAt,
        updatedAt,
      },
    ]);
  });

  it('passes LIMIT/OFFSET as parameters and excludes soft-deleted rows', async () => {
    queryMock().mockResolvedValue({ rows: [] });

    await serviceRepository.findAll(20, 3);

    const [sql, params] = queryMock().mock.calls[0]!;
    expect(params).toEqual([20, 40]);
    expectParameterized(sql, params);
    expect(sql).toMatch(/deleted_at IS NULL/);
  });

  it('defaults to the first page of 10', async () => {
    queryMock().mockResolvedValue({ rows: [] });

    await serviceRepository.findAll();

    expect(queryMock().mock.calls[0]![1]).toEqual([10, 0]);
  });
});

describe('userRepository', () => {
  beforeEach(() => vi.resetAllMocks());

  it('findById maps the row to a User and never exposes the password hash', async () => {
    queryMock().mockResolvedValue({ rows: [userRow] });

    const user = await userRepository.findById(userRow.id);

    expect(user).toEqual(expectedUser);
    const [sql, params] = queryMock().mock.calls[0]!;
    expect(params).toEqual([userRow.id]);
    expectParameterized(sql, params);
    expect(sql).not.toMatch(/password_hash/);
  });

  it('findById returns null when no user matches', async () => {
    queryMock().mockResolvedValue({ rows: [] });

    expect(await userRepository.findById('missing')).toBeNull();
  });

  it('findByEmail passes the email as a parameter', async () => {
    queryMock().mockResolvedValue({ rows: [userRow] });

    const user = await userRepository.findByEmail("jane@example.com' OR '1'='1");

    expect(user).toEqual(expectedUser);
    const [sql, params] = queryMock().mock.calls[0]!;
    expect(params).toEqual(["jane@example.com' OR '1'='1"]);
    expect(sql).not.toContain('jane@example.com');
  });

  it('create runs on the client it is given, so it can join a transaction', async () => {
    const txClient = { query: vi.fn().mockResolvedValue({ rows: [userRow] }) };

    const user = await userRepository.create('jane@example.com', 'hash', txClient as unknown as Pool);

    expect(user).toEqual(expectedUser);
    expect(pool.query).not.toHaveBeenCalled();
    expect(txClient.query.mock.calls[0]![1]).toEqual(['jane@example.com', 'hash']);
  });
});
