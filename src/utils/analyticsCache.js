const TTL_MS = 15 * 60 * 1000; // 15 minutes

const cacheMap = new Map();

let cacheHits = 0;
let cacheMisses = 0;
let totalGenerationTimeMs = 0;
let totalGenerationsCount = 0;

const getCacheKey = (userId, endpoint, query = {}) => {
  const queryStr = JSON.stringify(query);
  return `${userId}:${endpoint}:${queryStr}`;
};

const get = (userId, endpoint, query = {}) => {
  const key = getCacheKey(userId, endpoint, query);
  const cached = cacheMap.get(key);
  if (!cached) {
    cacheMisses++;
    return null;
  }

  const age = Date.now() - cached.timestamp;
  if (age > TTL_MS) {
    cacheMap.delete(key);
    cacheMisses++;
    return null;
  }

  cacheHits++;
  return cached.data;
};

const set = (userId, endpoint, query = {}, data) => {
  const key = getCacheKey(userId, endpoint, query);
  cacheMap.set(key, {
    timestamp: Date.now(),
    data
  });
};

const invalidateUserCache = (userId) => {
  if (!userId) return;
  const prefix = `${userId}:`;
  for (const key of cacheMap.keys()) {
    if (key.startsWith(prefix)) {
      cacheMap.delete(key);
    }
  }
};

const recordGenerationTime = (ms) => {
  totalGenerationTimeMs += ms;
  totalGenerationsCount++;
};

const getMetrics = () => {
  const avgGenTime = totalGenerationsCount > 0 ? totalGenerationTimeMs / totalGenerationsCount : 0;
  const totalLookups = cacheHits + cacheMisses;
  const hitRatio = totalLookups > 0 ? cacheHits / totalLookups : 0;
  
  return {
    cacheSize: cacheMap.size,
    cacheHits,
    cacheMisses,
    cacheHitRatio: hitRatio,
    averageGenerationTimeMs: avgGenTime,
    uptimeSeconds: process.uptime()
  };
};

const clear = () => {
  cacheMap.clear();
  cacheHits = 0;
  cacheMisses = 0;
  totalGenerationTimeMs = 0;
  totalGenerationsCount = 0;
};

module.exports = {
  get,
  set,
  invalidateUserCache,
  recordGenerationTime,
  getMetrics,
  clear
};
