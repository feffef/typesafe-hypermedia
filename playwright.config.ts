import { defineConfig } from '@playwright/test';

export default defineConfig({
    testDir: './test/playwright',
    timeout: 30_000,
    retries: 0,
    use: {
        baseURL: 'http://localhost:0', // overridden per-test via server fixture
        headless: true,
    },
    projects: [
        { name: 'chromium', use: { browserName: 'chromium' } },
    ],
});
