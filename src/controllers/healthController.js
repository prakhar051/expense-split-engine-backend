const prisma = require('../utils/prisma');
const redis = require('../utils/redis');
const { getSchedulerHealth } = require('../scheduler/recurringScheduler');
const { getPresenceMap, getIO } = require('../socket/socketServer');
const analyticsCache = require('../utils/analyticsCache');


const getHealth = async (req, res) => {
  return res.status(200).json({
    success: true,
    status: 'UP',
    timestamp: new Date().toISOString()
  });
};

const getReady = async (req, res) => {
  const status = {
    database: 'DOWN',
    redis: 'DOWN'
  };
  
  let isReady = true;

  // 1. Check Database
  try {
    await prisma.$queryRaw`SELECT 1`;
    status.database = 'UP';
  } catch (err) {
    isReady = false;
  }

  // 2. Check Redis
  try {
    if (redis && redis.status === 'ready') {
      status.redis = 'UP';
    } else {
      isReady = false;
    }
  } catch (err) {
    isReady = false;
  }

  const statusCode = isReady ? 200 : 503;
  return res.status(statusCode).json({
    success: isReady,
    status: isReady ? 'READY' : 'NOT_READY',
    components: status,
    timestamp: new Date().toISOString()
  });
};

const getMetrics = async (req, res) => {
  // Sockets connections metrics
  let activeSocketConnections = 0;
  const io = getIO();
  if (io) {
    activeSocketConnections = io.sockets.sockets.size;
  }

  // Scheduler metrics
  const scheduler = getSchedulerHealth();

  // OS / Process metrics
  const memoryUsage = process.memoryUsage();
  const cpuUsage = process.cpuUsage();

  return res.status(200).json({
    success: true,
    uptime: Math.round(process.uptime()),
    memory: {
      rss: memoryUsage.rss,
      heapTotal: memoryUsage.heapTotal,
      heapUsed: memoryUsage.heapUsed,
      external: memoryUsage.external,
      arrayBuffers: memoryUsage.arrayBuffers
    },
    cpu: {
      user: cpuUsage.user,
      system: cpuUsage.system
    },
    sockets: {
      activeConnections: activeSocketConnections
    },
    scheduler: {
      running: scheduler.schedulerRunning,
      uptime: scheduler.uptime,
      lastSuccessfulRun: scheduler.lastSuccessfulRun,
      lastFailedRun: scheduler.lastFailedRun
    },
    cache: analyticsCache.getMetrics(),
    timestamp: new Date().toISOString()
  });
};


const getVersion = async (req, res) => {
  return res.status(200).json({
    success: true,
    appVersion: process.env.APP_VERSION || '1.0.0',
    nodeVersion: process.version,
    environment: process.env.NODE_ENV || 'development',
    gitCommit: process.env.GIT_COMMIT || 'unknown',
    buildTimestamp: process.env.BUILD_TIMESTAMP || new Date().toISOString()
  });
};

module.exports = {
  getHealth,
  getReady,
  getMetrics,
  getVersion
};
