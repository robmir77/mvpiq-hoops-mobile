module.exports = {
  preset: 'react-native',
  setupFiles: ['<rootDir>/jest.setup.js'],
  setupFilesAfterEnv: ['@testing-library/jest-native/extend-expect'],
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@unimodules/.*|unimodules|sentry-expo|native-base|react-native-svg)',
  ],
  testMatch: ['**/__tests__/**/*.test.[jt]s?(x)', '!**/useTrackingEngine.test.ts', '!**/useWorkoutSessions.test.tsx'],
  collectCoverageFrom: [
    'src/**/*.{js,jsx,ts,tsx}',
    '!src/**/*.d.ts',
    '!src/**/*.stories.{js,jsx,ts,tsx}',
    '!src/**/__tests__/**',
  ],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
  testEnvironment: 'node',
  moduleNameMapper: {
    'expo/src/async-require/messageSocket': '<rootDir>/__mocks__/expo-async-require-mock.js',
    'expo-modules-core': '<rootDir>/__mocks__/expo-modules-core-mock.js',
    'expo-modules-core/src/polyfill/dangerous-internal': '<rootDir>/__mocks__/expo-modules-core-mock.js',
    '^@/(.*)$': '<rootDir>/src/$1',
  },
}
