// Mock for expo-modules-core
module.exports = {
  installExpoGlobalPolyfill: jest.fn(),
  ExpoModules: {
    modules: {},
  },
  modules: {},
};

// Also mock the dangerous-internal submodule
module.exports.src = {
  polyfill: {
    'dangerous-internal': module.exports,
  },
};
