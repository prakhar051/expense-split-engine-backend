require('dotenv').config();
// Validate environment immediately
require('./utils/envValidator');

const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const compression = require('compression');
const http = require('http');

const {
  logger,
  requestLogger,
  errorLogger,
  registerProcessErrorHandlers
} = require('./utils/logger');
const redis = require('./utils/redis');
const prisma = require('./utils/prisma');
const healthRoutes = require('./routes/healthRoutes');

// Register uncaught exception trackers
registerProcessErrorHandlers();

const app = express();
const PORT = process.env.PORT || 5000;

// Enable security and compression
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "res.cloudinary.com"],
      connectSrc: ["'self'", "wss:", "ws:"]
    }
  },
  referrerPolicy: { policy: 'same-origin' }
}));
app.use(compression());

// Trust Proxy
app.set('trust proxy', 1);

// Request timeout middleware (30 seconds)
app.use((req, res, next) => {
  res.setTimeout(30000, () => {
    logger.error({ url: req.originalUrl }, 'Request timeout exceeded (30 seconds)');
    res.status(503).json({ success: false, message: 'Service Unavailable: Request Timeout' });
  });
  next();
});

const clientUrlEnv = process.env.CLIENT_URL || 'http://localhost:5173';
const allowedOrigins = clientUrlEnv.split(',').map(o => o.trim()).filter(Boolean);

const corsOriginHandler = (origin, callback) => {
  if (!origin) {
    return callback(null, true);
  }
  const isAllowed = allowedOrigins.includes(origin);
  if (isAllowed) {
    callback(null, true);
  } else {
    const fallback = allowedOrigins.find(o => o.startsWith('https://')) || allowedOrigins[0];
    callback(null, fallback);
  }
};

// Enable CORS with client URL configuration
app.use(cors({
  origin: corsOriginHandler,
  credentials: true
}));

// Body parsers and request logging
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(requestLogger);

// Mount health routes under root
app.use('/', healthRoutes);

const swaggerUi = require('swagger-ui-express');
const openApiDocument = require('./openapi.json');

// Mount API Docs Swagger UI
app.use('/api/docs/openapi.json', (req, res) => {
  res.sendFile(require('path').join(__dirname, 'openapi.json'));
});
app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(openApiDocument));

const authRoutes  = require('./routes/authRoutes');
const groupRoutes = require('./routes/groupRoutes');
const expenseRoutes = require('./routes/expenseRoutes');
const settlementRoutes = require('./routes/settlementRoutes');
const dashboardRoutes = require('./routes/dashboardRoutes');
const userRoutes = require('./routes/userRoutes');
const notificationRoutes = require('./routes/notificationRoutes');
const aiRoutes = require('./routes/aiRoutes');
const recurringRoutes = require('./routes/recurringExpenseRoutes');
const currencyRoutes = require('./routes/currencyRoutes');
const budgetRoutes = require('./routes/budgetRoutes');
const analyticsRoutes = require('./routes/analyticsRoutes');
const groupAdminRoutes = require('./routes/groupAdminRoutes');

// Mount api routes
app.use('/api/auth',        authRoutes);
app.use('/api/groups',      groupAdminRoutes);
app.use('/api/groups',      groupRoutes);
app.use('/api/expenses',    expenseRoutes);
app.use('/api/settlements', settlementRoutes);
app.use('/api/dashboard',   dashboardRoutes);
app.use('/api/users',       userRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/ai',          aiRoutes);
app.use('/api/recurring',   recurringRoutes);
app.use('/api/currency',    currencyRoutes);
app.use('/api/v1/budgets',    budgetRoutes);
app.use('/api/v1/analytics',  analyticsRoutes);

// Health check backward-compatible status endpoint
app.use('/api/status', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'Backend server is running successfully.',
    timestamp: new Date()
  });
});

// Centralized error logger and error handler
app.use(errorLogger);
app.use((err, req, res, next) => {
  res.status(err.status || 500).json({
    success: false,
    message: err.message || 'Internal Server Error'
  });
});

// Wrap Express application in http server and initialize Socket.IO
const { initSocketServer } = require('./socket/socketServer');
const { startRecurringScheduler } = require('./scheduler/recurringScheduler');

const server = http.createServer(app);
initSocketServer(server);
if (process.env.NODE_ENV !== 'test') {
  startRecurringScheduler();
}

// Start listening
if (process.env.NODE_ENV !== 'test') {
  server.listen(PORT, () => {
    logger.info(`[Server] Running in ${process.env.NODE_ENV} mode on port ${PORT}`);
  });
}

// Graceful shutdown procedure
const gracefulShutdown = (signal) => {
  logger.info(`Received ${signal}. Initiating graceful shutdown...`);
  
  server.close(async () => {
    logger.info('HTTP Server closed.');
    try {
      await prisma.$disconnect();
      logger.info('Prisma connection disconnected.');
      
      if (redis) {
        await redis.quit();
        logger.info('Redis connection closed.');
      }
      
      logger.info('Graceful shutdown completed successfully. Exiting.');
      process.exit(0);
    } catch (err) {
      logger.error({ err }, 'Error during database disconnect in graceful shutdown.');
      process.exit(1);
    }
  });

  // Force exit after 10s if sockets or jobs hang
  setTimeout(() => {
    logger.fatal('Graceful shutdown timed out, forcefully exiting.');
    process.exit(1);
  }, 10000);
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

module.exports = app;

