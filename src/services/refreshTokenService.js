const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const prisma = require('../utils/prisma');

/**
 * SHA-256 Hashing helper
 */
const hashToken = (token) => {
  return crypto.createHash('sha256').update(token).digest('hex');
};

/**
 * Create a new session (Access token + Refresh token) for a user
 *
 * @param {string} userId - User UUID
 */
const createSession = async (userId) => {
  const jwtSecret = process.env.JWT_SECRET || 'dev_access_token_secret_987654321_abc';

  // Fetch user to include email in JWT payload
  const user = await prisma.user.findUnique({
    where: { id: userId }
  });
  if (!user) {
    const err = new Error('User not found');
    err.status = 404;
    throw err;
  }

  // 1. Generate 15-minute Access Token
  const accessToken = jwt.sign(
    { id: user.id, email: user.email },
    jwtSecret,
    { expiresIn: '15m' }
  );

  // 2. Generate 7-day cryptographically secure raw Refresh Token
  const rawRefreshToken = crypto.randomBytes(40).toString('hex');
  const tokenHash = hashToken(rawRefreshToken);
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

  // 3. Store hashed token in database
  await prisma.refreshToken.create({
    data: {
      userId,
      tokenHash,
      expiresAt
    }
  });

  return {
    accessToken,
    refreshToken: rawRefreshToken
  };
};

/**
 * Rotate refresh token and issue a new access token (RTR)
 * If reuse/replay is detected, all user sessions are immediately revoked.
 *
 * @param {string} rawRefreshToken - Plainttext refresh token
 */
const refreshSession = async (rawRefreshToken) => {
  if (!rawRefreshToken) {
    const err = new Error('Refresh token is required');
    err.status = 400;
    throw err;
  }

  const tokenHash = hashToken(rawRefreshToken);

  // 1. Fetch matching Refresh Token record
  const record = await prisma.refreshToken.findUnique({
    where: { tokenHash }
  });

  if (!record) {
    const err = new Error('Invalid refresh token');
    err.status = 401;
    throw err;
  }

  // 2. Reuse/Replay Detection:
  // If the refresh token has already been marked revoked, this is a breach attempt.
  if (record.revokedAt !== null) {
    // Revoke all active sessions for this compromised user
    await prisma.refreshToken.updateMany({
      where: {
        userId: record.userId,
        revokedAt: null
      },
      data: {
        revokedAt: new Date()
      }
    });

    const err = new Error('Refresh token reuse detected. All active sessions have been revoked. Please login again.');
    err.status = 401;
    throw err;
  }

  // 3. Expiry check
  if (record.expiresAt < new Date()) {
    const err = new Error('Refresh token has expired');
    err.status = 401;
    throw err;
  }

  // 4. Token is valid -> Revoke it (rotate) and generate new pair
  await prisma.refreshToken.update({
    where: { id: record.id },
    data: { revokedAt: new Date() }
  });

  // Create new session
  return createSession(record.userId);
};

/**
 * Revoke a single active session (Logout)
 *
 * @param {string} rawRefreshToken - Plaintext refresh token
 */
const revokeSession = async (rawRefreshToken) => {
  if (!rawRefreshToken) {
    const err = new Error('Refresh token is required');
    err.status = 400;
    throw err;
  }

  const tokenHash = hashToken(rawRefreshToken);

  const record = await prisma.refreshToken.findUnique({
    where: { tokenHash }
  });

  if (!record) {
    const err = new Error('Invalid refresh token');
    err.status = 401;
    throw err;
  }

  // Revoke if not already revoked
  if (record.revokedAt === null) {
    await prisma.refreshToken.update({
      where: { id: record.id },
      data: { revokedAt: new Date() }
    });
  }
};

/**
 * Revoke all active sessions for a user (Logout from all devices)
 *
 * @param {string} userId - User UUID
 */
const revokeAllSessions = async (userId) => {
  await prisma.refreshToken.updateMany({
    where: {
      userId,
      revokedAt: null
    },
    data: {
      revokedAt: new Date()
    }
  });
};

module.exports = {
  createSession,
  refreshSession,
  revokeSession,
  revokeAllSessions,
  hashToken
};
