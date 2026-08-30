// Setup file for Jest to define global variables
global.__DEV__ = true;

// Mock expo-modules-core before jest-expo setup runs
global.ExpoModules = {
  modules: {},
};

// Mock globalThis.expo for jest-expo
globalThis.expo = {
  EventEmitter: class EventEmitter {
    addListener() {}
    removeListener() {}
    removeAllListeners() {}
    emit() {}
  },
};

// Mock AsyncStorage
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

// Mock test-renderer for @testing-library/react-native
jest.mock('test-renderer', () => ({
  create: jest.fn(),
  act: jest.fn((callback) => {
    callback()
  }),
  createRoot: jest.fn(() => ({
    render: jest.fn(),
    unmount: jest.fn(),
  })),
}), { virtual: true })

// Mock react-native-reanimated
jest.mock('react-native-reanimated', () => ({
  useSharedValue: jest.fn((initial) => ({ value: initial })),
  useDerivedValue: jest.fn((fn) => ({ value: fn() })),
  withTiming: jest.fn(),
  withSpring: jest.fn(),
  runOnJS: jest.fn((fn) => fn),
}))

// Mock appConfig to avoid dynamic import errors
jest.mock('@/config/appConfig', () => ({
  API_BASE_URL: 'http://localhost:3000',
}))
