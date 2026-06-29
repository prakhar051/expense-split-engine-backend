const mockIO = {
  to: jest.fn().mockReturnThis(),
  emit: jest.fn(),
  sockets: {
    sockets: new Map()
  }
};

const mockSocketServer = {
  sendToUser: jest.fn(),
  broadcastToGroup: jest.fn(),
  getIO: jest.fn().mockReturnValue(mockIO),
  getPresenceMap: jest.fn().mockReturnValue(new Map()),
  initSocketServer: jest.fn(),
  mockIO
};

jest.mock('../../src/socket/socketServer', () => mockSocketServer);

module.exports = mockSocketServer;
