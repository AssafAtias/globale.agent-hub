export default {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/test/**/*.test.ts'],
  clearMocks: true,
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  transform: {
    '^.+\\.tsx?$': 'ts-jest',
    '^.+\\.js$': ['ts-jest', { diagnostics: false }],
  },
  transformIgnorePatterns: [
    'node_modules/(?!(openid-client|oauth4webapi|jose)/)',
  ],
};
