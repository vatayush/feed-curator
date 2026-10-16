import { defineConfig } from 'vitest/config';

// A zone with daylight saving, so the schedule tests cover the clock changes on any machine.
process.env.TZ = 'America/Los_Angeles';

export default defineConfig({
  test: { environment: 'jsdom', globals: true },
});
