// Mock for test-renderer
const React = require('react')

module.exports = {
  create: jest.fn(),
  act: jest.fn((callback) => {
    callback()
  }),
  createRoot: jest.fn(() => ({
    render: jest.fn(),
    unmount: jest.fn(),
  })),
}
