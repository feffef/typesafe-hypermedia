/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
    preset: 'ts-jest',
    testEnvironment: 'node',
    // Test patterns include:
    // - test/unit/*.test.ts - Unit tests
    // - test/integration/*.spec.ts - Integration tests (mocked fetch)
    // - test/e2e/*.spec.ts - E2E tests (real servers)
    testMatch: [
        '**/test/**/*.spec.ts',
        '**/test/**/*.test.ts',
        '**/examples/**/*.test.ts',
    ],
    testPathIgnorePatterns: ['/node_modules/', '<rootDir>/\\.claude/worktrees/', '<rootDir>/test/playwright/'],
    moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
    collectCoverageFrom: ['src/**/*.ts'],
    coverageThreshold: {
        global: {
            statements: 100,
            branches: 100,
            functions: 100,
            lines: 100,
        },
    },
    moduleNameMapper: {
        '^@/(.*)$': '<rootDir>/src/$1'
    }
};
