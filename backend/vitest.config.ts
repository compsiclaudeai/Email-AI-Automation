import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Tests here are pure: nothing touches Mongo, a provider or a model API.
    // Anything that needs those is an integration test and lives behind
    // `npm run test:integration` once a test database is available.
    globals: false,
  },
});
