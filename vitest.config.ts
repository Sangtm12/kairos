import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Tests live outside src/ so `tsc` never compiles them into dist/.
    include: ['test/**/*.test.ts'],

    // src/config/env.ts validates process.env on import and exits if anything is missing.
    // Setting the values here makes the suite independent of your shell and your .env file.
    // The DB values are never dialled: tests mock the database boundary.
    env: {
      NODE_ENV: 'test',
      PORT: '3000',
      DB_HOST: 'localhost',
      DB_PORT: '5432',
      DB_USER: 'test',
      DB_PASSWORD: 'test',
      DB_NAME: 'test',
    },
  },
});
