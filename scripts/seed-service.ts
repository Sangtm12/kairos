import { config } from '../src/config/env.js';
import { withTransaction } from '../src/db/with-transaction.js';
import { pool } from '../src/db/client.js';

const NUMBER_OF_USERS = 2000;
const NUMBER_OF_SERVICES = 100_000;
const CITIES = ['HN', 'HCM', 'DN', 'HY'] as const;
const SERVICE_TITLES = [
  'Haircut',
  'Massage',
  'Yoga class',
  'Consultation',
  'Tutoring',
  'Photo shoot',
];
const DURATIONS = [15, 30, 45, 60, 90, 120];
const BUFFERS = [0, 0, 5, 10, 15];
const DAY_MS = 24 * 60 * 60 * 1000;
const SEED_START = new Date('2024-01-01T00:00:00+07:00');

// A random moment between `from` and `from + maxDays`.
const randomDateAfter = (from: Date, maxDays: number): Date =>
  new Date(from.getTime() + Math.random() * maxDays * DAY_MS);

// Skewed on purpose: HN holds half the providers, so filters on city have uneven selectivity.
const pickCity = (): (typeof CITIES)[number] => {
  const rand = Math.random();
  if (rand < 0.5) return 'HN';
  if (rand < 0.7) return 'HCM';
  if (rand < 0.8) return 'DN';
  return 'HY';
};

const pick = <T>(items: readonly T[]): T => items[Math.floor(Math.random() * items.length)] as T;

// Inclusive on both ends, every value equally likely.
const randomInt = (min: number, max: number): number =>
  Math.floor(Math.random() * (max - min + 1)) + min;

// Appends one row's values to `values` and returns its "($n,$n+1,...)" group.
// Numbering comes from values.length, so adding a column can never shift the placeholders.
const toPlaceholders = (values: unknown[], row: unknown[]): string =>
  `(${row
    .map((value) => {
      values.push(value);
      return `$${values.length}`;
    })
    .join(',')})`;

const seedServices = async () => {
  if (config.nodeEnv === 'production') {
    throw new Error('Refusing to seed in production');
  }

  await withTransaction(async (client) => {
    await client.query('TRUNCATE TABLE services, provider_profiles, users CASCADE');
    console.time('users + provider_profiles');

    // seed users
    const userValues: unknown[] = [];
    const userQuery = Array.from({ length: NUMBER_OF_USERS }, (_, index) => {
      const createdAt = randomDateAfter(SEED_START, 365);
      return toPlaceholders(userValues, [
        `user-${index}@test.com`,
        // Not a real hash: seeded users cannot log in once auth lands in M2.
        'qweqwe',
        createdAt,
        randomDateAfter(createdAt, 180),
        'provider',
      ]);
    }).join(',');

    // created_at comes back too, so each profile can be dated after its own user
    // without relying on RETURNING preserving the VALUES order.
    const { rows: users } = await client.query<{ id: string; created_at: Date }>(
      `
      INSERT INTO users (email, password_hash, created_at, updated_at, role)
      VALUES ${userQuery}
      RETURNING id, created_at
    `,
      userValues,
    );

    // seed provider profiles
    const providerValues: unknown[] = [];
    const providerQuery = users
      .map(({ id: userId, created_at: userCreatedAt }, index) => {
        const createdAt = randomDateAfter(userCreatedAt, 30);
        return toPlaceholders(providerValues, [
          userId,
          `provider-${index + 1}`,
          createdAt,
          randomDateAfter(createdAt, 180),
          pickCity(),
        ]);
      })
      .join(',');

    const { rows: providers } = await client.query<{ id: string; created_at: Date }>(
      `
      INSERT INTO provider_profiles (user_id, display_name, created_at, updated_at, city)
      VALUES ${providerQuery}
      RETURNING id, created_at
    `,
      providerValues,
    );
    console.timeEnd('users + provider_profiles');

    // seed services
    console.time('services');
    // The last 5% of providers get no services at all (KAI-016 hunts for them).
    const providersWithServices = providers.slice(0, Math.floor(providers.length * 0.95));
    const columns = {
      providerId: [] as string[],
      title: [] as string[],
      priceMinor: [] as number[],
      durationMinutes: [] as number[],
      bufferBeforeMinutes: [] as number[],
      bufferAfterMinutes: [] as number[],
      createdAt: [] as Date[],
      updatedAt: [] as Date[],
      deletedAt: [] as (Date | null)[],
    };
    for (let i = 0; i < NUMBER_OF_SERVICES; i++) {
      // Cubing a uniform number piles it up near 0, so a few providers own thousands of
      // services while most own a few dozen. Uniform data would hide selectivity effects.
      const index = Math.floor(providersWithServices.length * Math.random() ** 3);
      const provider = providersWithServices[index] as (typeof providers)[number];
      const createdAt = randomDateAfter(provider.created_at, 365);

      columns.providerId.push(provider.id);
      columns.title.push(`${pick(SERVICE_TITLES)} #${i + 1}`);
      columns.priceMinor.push(randomInt(50, 2000) * 1000);
      columns.durationMinutes.push(pick(DURATIONS));
      columns.bufferBeforeMinutes.push(pick(BUFFERS));
      columns.bufferAfterMinutes.push(pick(BUFFERS));
      columns.createdAt.push(createdAt);
      columns.updatedAt.push(randomDateAfter(createdAt, 90));
      // ~5% soft-deleted, so the `deleted_at IS NULL` filter actually removes rows.
      columns.deletedAt.push(Math.random() < 0.05 ? randomDateAfter(createdAt, 90) : null);
    }

    // unnest zips the arrays back into rows: one parameter per column, however many rows.
    // A multi-row VALUES would need 900k parameters here, far past Postgres' 65,535 limit.
    await client.query(
      `
      INSERT INTO services (
        provider_id, title, price_minor, duration_minutes, buffer_before_minutes,
        buffer_after_minutes, created_at, updated_at, deleted_at
      )
      SELECT * FROM unnest(
        $1::uuid[], $2::text[], $3::bigint[], $4::int[], $5::int[],
        $6::int[], $7::timestamptz[], $8::timestamptz[], $9::timestamptz[]
      )
    `,
      [
        columns.providerId,
        columns.title,
        columns.priceMinor,
        columns.durationMinutes,
        columns.bufferBeforeMinutes,
        columns.bufferAfterMinutes,
        columns.createdAt,
        columns.updatedAt,
        columns.deletedAt,
      ],
    );
    console.timeEnd('services');

    // Refresh planner statistics now; otherwise the first EXPLAINs run on stale row estimates.
    console.time('analyze');
    await client.query('ANALYZE users, provider_profiles, services');
    console.timeEnd('analyze');
  });
};

seedServices()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
