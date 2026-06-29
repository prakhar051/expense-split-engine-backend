const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const prisma = require('../utils/prisma');
const refreshTokenService = require('./refreshTokenService');

const JWT_SECRET = process.env.JWT_SECRET || 'dev_access_token_secret_987654321_abc';
const JWT_EXPIRES_IN = '15m'; // Access token expiry (e.g. 15 minutes)

/**
 * Generate a JWT token for a user
 * @param {Object} user 
 * @returns {string} token
 */
const generateToken = (user) => {
  return jwt.sign(
    { id: user.id, email: user.email },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
};

/**
 * Register a new user
 * @param {Object} userData 
 * @returns {Promise<Object>} Object containing user info and token
 */
const register = async (userData) => {
  const { email, password, name, avatar } = userData;

  // Check if email already exists
  const existingUser = await prisma.user.findUnique({
    where: { email }
  });

  if (existingUser) {
    const error = new Error('Email is already registered');
    error.status = 400;
    throw error;
  }

  // Hash password using bcryptjs
  const hashedPassword = await bcrypt.hash(password, 12);

  // Create user in database
  const user = await prisma.user.create({
    data: {
      email,
      name,
      password: hashedPassword,
      avatar: avatar || null
    }
  });

  // Generate tokens
  const session = await refreshTokenService.createSession(user.id);

  return {
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      avatar: user.avatar
    },
    accessToken: session.accessToken,
    refreshToken: session.refreshToken
  };
};

/**
 * Authenticate a user by email and password
 * @param {string} email 
 * @param {string} password 
 * @returns {Promise<Object>} Object containing user info and token
 */
const login = async (email, password) => {
  // Find user by email
  const user = await prisma.user.findUnique({
    where: { email }
  });

  if (!user) {
    const error = new Error('Invalid email or password');
    error.status = 401;
    throw error;
  }

  // Compare password hash
  const isMatch = await bcrypt.compare(password, user.password);
  if (!isMatch) {
    const error = new Error('Invalid email or password');
    error.status = 401;
    throw error;
  }

  // Generate tokens
  const session = await refreshTokenService.createSession(user.id);

  return {
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      avatar: user.avatar
    },
    accessToken: session.accessToken,
    refreshToken: session.refreshToken
  };
};

module.exports = {
  register,
  login,
  generateToken
};
