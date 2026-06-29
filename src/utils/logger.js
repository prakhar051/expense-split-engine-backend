const pino = require('pino');
const crypto = require('crypto');

const isDev = process.env.NODE_ENV !== 'production';

// Main Pino logger instance
const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  base: {
    env: process.env.NODE_ENV,
    version: process.env.APP_VERSION || '1.0.0'
  },
  transport: isDev
    ? {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:standard',
          ignore: 'pid,hostname,env,version'
        }
      }
    : undefined
});

// Helper child loggers
const cronLogger = logger.child({ context: 'cron' });
const socketLogger = logger.child({ context: 'socket' });
const aiLogger = logger.child({ context: 'ai' });
const schedulerLogger = logger.child({ context: 'scheduler' });
const exportLogger = logger.child({ context: 'export' });
const analyticsLogger = logger.child({ context: 'analytics' });
const securityLogger = logger.child({ context: 'security' });

// Request logging middleware
const requestLogger = (req, res, next) => {
  const start = Date.now();
  
  // Inject or reuse requestId
  req.id = req.headers['x-request-id'] || req.id || crypto.randomUUID();
  res.setHeader('X-Request-ID', req.id);

  // Intercept response finish
  res.on('finish', () => {
    const duration = Date.now() - start;
    
    // Extract potential group context from path or body
    let groupId = req.params?.groupId || req.body?.groupId || req.query?.groupId || null;
    if (!groupId && req.originalUrl) {
      const match = req.originalUrl.match(/\/groups\/([a-fA-F0-9-]{36})/);
      if (match) groupId = match[1];
    }

    logger.info({
      requestId: req.id,
      userId: req.user?.id || null,
      groupId,
      method: req.method,
      url: req.originalUrl || req.url,
      status: res.statusCode,
      duration: `${duration}ms`,
      ip: req.ip || req.connection?.remoteAddress,
      userAgent: req.headers['user-agent']
    }, `${req.method} ${req.originalUrl || req.url} - Status ${res.statusCode} (${duration}ms)`);
  });

  next();
};

// Error logging middleware
const errorLogger = (err, req, res, next) => {
  logger.error({
    requestId: req.id,
    userId: req.user?.id || null,
    method: req.method,
    url: req.originalUrl || req.url,
    error: {
      message: err.message,
      stack: err.stack,
      status: err.status
    }
  }, `Express Error Handler: ${err.message}`);
  next(err);
};

// Setup exception tracking listeners
const registerProcessErrorHandlers = () => {
  process.on('uncaughtException', (err) => {
    logger.fatal({
      error: {
        message: err.message,
        stack: err.stack
      }
    }, 'CRITICAL: Uncaught Exception detected. Process exiting.');
    process.exit(1);
  });

  process.on('unhandledRejection', (reason, promise) => {
    logger.error({
      reason: reason instanceof Error ? { message: reason.message, stack: reason.stack } : reason
    }, 'Unhandled Promise Rejection detected.');
  });
};

module.exports = {
  logger,
  cronLogger,
  socketLogger,
  aiLogger,
  schedulerLogger,
  exportLogger,
  analyticsLogger,
  securityLogger,
  requestLogger,
  errorLogger,
  registerProcessErrorHandlers
};
