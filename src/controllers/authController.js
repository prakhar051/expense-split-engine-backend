const authService = require('../services/authService');
const refreshTokenService = require('../services/refreshTokenService');
const { registerSchema, loginSchema } = require('../validators/authValidator');
const prisma = require('../utils/prisma');

/**
 * Handle user registration request
 */
const register = async (req, res, next) => {
  try {
    // Validate request payload structure using Zod schema
    const validatedData = registerSchema.parse(req.body);
    
    // Delegate database write and token generation to service layer
    const result = await authService.register(validatedData);
    
    res.cookie('refreshToken', result.refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
    });

    return res.status(201).json({
      success: true,
      message: 'User registered successfully.',
      user: result.user,
      accessToken: result.accessToken,
      refreshToken: result.refreshToken
    });
  } catch (error) {
    // Handle Zod validation errors structurally
    if (error.name === 'ZodError') {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: error.issues.map(err => ({
          field: err.path.join('.'),
          message: err.message
        }))
      });
    }
    next(error);
  }
};

/**
 * Handle user login request
 */
const login = async (req, res, next) => {
  try {
    // Validate credentials structure using Zod schema
    const validatedData = loginSchema.parse(req.body);
    
    // Verify credentials and fetch token
    const result = await authService.login(validatedData.email, validatedData.password);
    
    res.cookie('refreshToken', result.refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
    });

    return res.status(200).json({
      success: true,
      message: 'Logged in successfully.',
      user: result.user,
      accessToken: result.accessToken,
      refreshToken: result.refreshToken
    });
  } catch (error) {
    // Handle Zod validation errors structurally
    if (error.name === 'ZodError') {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: error.issues.map(err => ({
          field: err.path.join('.'),
          message: err.message
        }))
      });
    }
    // Set explicit status code for service validation errors (e.g. 401 Unauthorized)
    if (error.status) {
      return res.status(error.status).json({
        success: false,
        message: error.message
      });
    }
    next(error);
  }
};

/**
 * Fetch authenticated user profile details
 */
const getMe = async (req, res, next) => {
  try {
    // Query database for up-to-date user details using context attached by authenticateToken middleware
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: {
        id: true,
        name: true,
        email: true,
        avatar: true,
        createdAt: true
      }
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User profile not found.'
      });
    }

    return res.status(200).json({
      success: true,
      user
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Rotate refresh token and issue a new access token
 */
const refreshToken = async (req, res, next) => {
  try {
    const token = req.cookies?.refreshToken || req.body?.refreshToken;
    const result = await refreshTokenService.refreshSession(token);
    
    res.cookie('refreshToken', result.refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
    });

    return res.status(200).json({
      success: true,
      accessToken: result.accessToken,
      refreshToken: result.refreshToken
    });
  } catch (error) {
    if (error.status) {
      return res.status(error.status).json({
        success: false,
        message: error.message
      });
    }
    next(error);
  }
};

/**
 * Revoke a refresh token (Logout)
 */
const logout = async (req, res, next) => {
  try {
    const token = req.cookies?.refreshToken || req.body?.refreshToken;
    await refreshTokenService.revokeSession(token);
    
    res.clearCookie('refreshToken');

    return res.status(200).json({
      success: true,
      message: 'Logged out successfully.'
    });
  } catch (error) {
    if (error.status) {
      return res.status(error.status).json({
        success: false,
        message: error.message
      });
    }
    next(error);
  }
};

/**
 * Revoke all refresh tokens for a user (Logout from all devices)
 */
const logoutAll = async (req, res, next) => {
  try {
    await refreshTokenService.revokeAllSessions(req.user.id);
    
    res.clearCookie('refreshToken');

    return res.status(200).json({
      success: true,
      message: 'Logged out from all devices successfully.'
    });
  } catch (error) {
    if (error.status) {
      return res.status(error.status).json({
        success: false,
        message: error.message
      });
    }
    next(error);
  }
};

module.exports = {
  register,
  login,
  getMe,
  refreshToken,
  logout,
  logoutAll
};
