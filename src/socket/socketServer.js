const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const prisma = require('../utils/prisma');
const SocketEvents = require('./socketEvents');

const JWT_SECRET = process.env.JWT_SECRET || 'dev_access_token_secret_987654321_abc';

let io = null;

// In-memory presence map: userId -> { socketIds: Set, lastSeen: timestamp, online: boolean }
const presenceMap = new Map();

// Helper to create standard event envelopes
function createEventEnvelope(event, payload, userId = null, groupId = null) {
  return {
    eventId: crypto.randomUUID(),
    eventVersion: '1.0.0',
    timestamp: Date.now(),
    event,
    groupId,
    userId,
    payload
  };
}

// Helper to find which users are online in a group and emit the update
async function emitGroupPresenceUpdate(groupId) {
  try {
    const members = await prisma.groupMember.findMany({
      where: { groupId },
      select: { userId: true }
    });

    const onlineUserIds = members
      .map((m) => m.userId)
      .filter((uid) => {
        const pres = presenceMap.get(uid);
        return pres && pres.online;
      });

    const envelope = createEventEnvelope(
      SocketEvents.ONLINE_USERS_UPDATED,
      { onlineUserIds },
      null,
      groupId
    );

    io.to(`group:${groupId}`).emit(SocketEvents.ONLINE_USERS_UPDATED, envelope);
  } catch (err) {
    console.error(`[emitGroupPresenceUpdate Error] Failed to update presence for group ${groupId}:`, err);
  }
}

function initSocketServer(httpServer) {
  io = new Server(httpServer, {
    cors: {
      origin: process.env.CLIENT_URL || 'http://localhost:5173',
      credentials: true
    },
    connectionStateRecovery: {
      maxDisconnectionDuration: 2 * 60 * 1000, // 2 minutes
      skipMiddlewares: true
    }
  });

  // JWT Handshake Authentication Middleware
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) {
      return next(new Error('Authentication error: Access Token missing.'));
    }

    try {
      const verified = jwt.verify(token, JWT_SECRET);
      socket.userId = verified.id;
      socket.userEmail = verified.email;
      next();
    } catch (err) {
      return next(new Error('Authentication error: Invalid or expired token.'));
    }
  });

  io.on('connection', async (socket) => {
    const userId = socket.userId;
    console.log(`[Socket] Client connected. Socket ID: ${socket.id}, User ID: ${userId}`);

    // Join personal room
    socket.join(`user:${userId}`);

    // Load group memberships and join group rooms
    let userGroups = [];
    try {
      const memberships = await prisma.groupMember.findMany({
        where: { userId, isBanned: false },
        select: { groupId: true }
      });
      userGroups = memberships.map((m) => m.groupId);
      userGroups.forEach((groupId) => {
        socket.join(`group:${groupId}`);
      });
    } catch (err) {
      console.error(`[Socket Connection Error] Failed to load group rooms for user ${userId}:`, err);
    }

    // Update Presence Map
    let userPresence = presenceMap.get(userId);
    const wasOffline = !userPresence || !userPresence.online;

    if (!userPresence) {
      userPresence = {
        socketIds: new Set([socket.id]),
        lastSeen: Date.now(),
        online: true
      };
      presenceMap.set(userId, userPresence);
    } else {
      userPresence.socketIds.add(socket.id);
      userPresence.online = true;
      userPresence.lastSeen = Date.now();
    }

    // If transitioned from offline to online, broadcast presence updates to all group rooms
    if (wasOffline) {
      userGroups.forEach((groupId) => {
        emitGroupPresenceUpdate(groupId);
      });
    }

    // Ping latency monitor listener
    socket.on('heartbeat', (timestamp, callback) => {
      if (typeof callback === 'function') {
        callback(timestamp);
      }
    });

    // Manual join room (e.g. when creating or joining a group)
    socket.on('join-group', async (groupId) => {
      try {
        const member = await prisma.groupMember.findUnique({
          where: { groupId_userId: { groupId, userId } }
        });
        if (!member || member.isBanned) {
          console.warn(`[Socket] Banned or non-member user ${userId} tried to join group:${groupId}`);
          return;
        }
        socket.join(`group:${groupId}`);
        console.log(`[Socket] User ${userId} joined room group:${groupId}`);
        await emitGroupPresenceUpdate(groupId);
      } catch (err) {
        console.error(`[Socket join-group Error] User ${userId} failed joining ${groupId}:`, err);
      }
    });


    // Manual leave room (e.g. when leaving a group)
    socket.on('leave-group', async (groupId) => {
      socket.leave(`group:${groupId}`);
      console.log(`[Socket] User ${userId} left room group:${groupId}`);
      await emitGroupPresenceUpdate(groupId);
    });

    socket.on('disconnect', async () => {
      console.log(`[Socket] Client disconnected. Socket ID: ${socket.id}`);
      
      const pres = presenceMap.get(userId);
      if (pres) {
        pres.socketIds.delete(socket.id);
        if (pres.socketIds.size === 0) {
          pres.online = false;
          pres.lastSeen = Date.now();

          // Broadcast offline state to all user groups
          try {
            const memberships = await prisma.groupMember.findMany({
              where: { userId, isBanned: false },
              select: { groupId: true }
            });
            memberships.forEach((m) => {
              emitGroupPresenceUpdate(m.groupId);
            });

          } catch (err) {
            console.error('[Socket Disconnect Error] Failed to fetch memberships on exit:', err);
          }
        }
      }
    });
  });

  return io;
}

function getIO() {
  return io;
}

function getPresenceMap() {
  return presenceMap;
}

// Broadcast to a specific group room, optionally excluding initiator socket ID
function broadcastToGroup(groupId, event, payload, initiatorUserId = null, excludeSocketId = null) {
  if (!io) return;
  const envelope = createEventEnvelope(event, payload, initiatorUserId, groupId);
  let sender = io.to(`group:${groupId}`);
  if (excludeSocketId) {
    sender = sender.except(excludeSocketId);
  }
  sender.emit(event, envelope);
}

// Send user-specific event to a personal user room
function sendToUser(userId, event, payload, initiatorUserId = null) {
  if (!io) return;
  const envelope = createEventEnvelope(event, payload, initiatorUserId, null);
  io.to(`user:${userId}`).emit(event, envelope);
}

// Send global event to all connected sockets
function broadcastGlobal(event, payload, initiatorUserId = null) {
  if (!io) return;
  const envelope = createEventEnvelope(event, payload, initiatorUserId, null);
  io.emit(event, envelope);
}

module.exports = {
  initSocketServer,
  getIO,
  getPresenceMap,
  broadcastToGroup,
  sendToUser,
  broadcastGlobal,
  emitGroupPresenceUpdate
};
