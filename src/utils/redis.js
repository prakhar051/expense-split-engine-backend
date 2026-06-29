const Redis = require('ioredis');
const { logger } = require('./logger');

const redisUrl = process.env.REDIS_URL;

if (!redisUrl) {
  logger.error('REDIS_URL env variable is not configured');
  process.exit(1);
}

const redis = new Redis(redisUrl, {
  maxRetriesPerRequest: 3,
  retryStrategy(times) {
    // Retry connection up to 3 times before failing
    if (times > 3) {
      logger.error('Redis connection failed after 3 retries.');
      return null; // Stop retrying
    }
    const delay = Math.min(times * 200, 1000);
    return delay;
  }
});

redis.on('connect', () => {
  logger.info('Connected to Redis server.');
});

redis.on('error', (err) => {
  logger.error({ err: err.message }, 'Redis connection error:');
});

module.exports = redis;
