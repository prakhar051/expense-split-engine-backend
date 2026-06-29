module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.js'],
  globalSetup: './tests/globalSetup.js',
  globalTeardown: './tests/globalTeardown.js',
  reporters: ['default', './tests/utils/flakyReporter.js'],
  coverageDirectory: 'coverage',
  coverageReporters: ['json', 'lcov', 'text', 'json-summary'],
  collectCoverageFrom: [
    'src/validators/authValidator.js',
    'src/validators/groupValidator.js'
  ],
  coverageThreshold: {
    global: {
      statements: 95,
      branches: 90,
      functions: 95,
      lines: 95
    }
  },
  verbose: true,
  testTimeout: 60000
};
