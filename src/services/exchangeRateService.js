const prisma = require('../utils/prisma');
const SocketEvents = require('../socket/socketEvents');

const BASE_CURRENCY = process.env.BASE_CURRENCY || 'INR';

// In-memory cache to avoid querying database on every request
let inMemorySnapshot = null;

// List of supported currencies in the schema
const SUPPORTED_CURRENCIES = ['INR', 'USD', 'EUR', 'GBP', 'JPY', 'AUD', 'CAD', 'SGD', 'AED'];

/**
 * Downloads rates from Frankfurter API
 */
async function fetchFrankfurter(base) {
  const url = `https://api.frankfurter.app/latest?base=${base}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Frankfurter returned HTTP ${response.status}`);
  }
  const data = await response.json();
  if (!data || !data.rates) {
    throw new Error('Frankfurter returned invalid JSON structure');
  }
  return {
    provider: 'Frankfurter',
    baseCurrency: base,
    rates: {
      [base]: 1.0,
      ...data.rates
    }
  };
}

/**
 * Downloads rates from Open ER API
 */
async function fetchOpenER(base) {
  const url = `https://open.er-api.com/v6/latest/${base}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Open ER returned HTTP ${response.status}`);
  }
  const data = await response.json();
  if (!data || !data.rates) {
    throw new Error('Open ER returned invalid JSON structure');
  }
  return {
    provider: 'OpenER',
    baseCurrency: base,
    rates: data.rates
  };
}

/**
 * Download rates using provider fallback chain
 */
async function fetchRatesFromProviders(base) {
  console.log(`[ExchangeRate] Fetching latest rates for base currency ${base}...`);
  const startTime = Date.now();

  try {
    const result = await fetchFrankfurter(base);
    // Ensure all supported currencies are present, otherwise fallback to OpenER
    const hasAllCurrencies = SUPPORTED_CURRENCIES.every(c => c in result.rates);
    if (hasAllCurrencies) {
      return { ...result, duration: Date.now() - startTime };
    }
    console.warn('[ExchangeRate] Frankfurter is missing some supported currencies (e.g. AED). Falling back to OpenER.');
  } catch (err) {
    console.warn(`[ExchangeRate] Frankfurter fetch failed: ${err.message}. Falling back to OpenER.`);
  }

  try {
    const result = await fetchOpenER(base);
    return { ...result, duration: Date.now() - startTime };
  } catch (err) {
    console.error(`[ExchangeRate] Open ER fetch failed: ${err.message}`);
    throw err;
  }
}

/**
 * Save snapshot and trigger broadcasts/activities
 */
async function saveSnapshot(provider, baseCurrency, rates, duration = 0) {
  const snapshot = await prisma.exchangeRateSnapshot.create({
    data: {
      provider,
      baseCurrency,
      rates
    }
  });

  inMemorySnapshot = snapshot;

  // Log activity
  const currenciesUpdated = Object.keys(rates).filter(c => SUPPORTED_CURRENCIES.includes(c));
  const { logActivity } = require('./activityService');
  try {
    await logActivity(
      null,
      'EXCHANGE_RATE_REFRESHED',
      `Exchange rates refreshed successfully from ${provider}.`,
      null,
      {
        provider,
        baseCurrency,
        currenciesUpdated,
        duration
      }
    );
  } catch (err) {
    console.error('[ExchangeRate] Failed to log activity:', err);
  }

  // Broadcast to Socket.IO
  try {
    const { broadcastToGroup } = require('../socket/socketServer');
    broadcastToGroup(null, SocketEvents.EXCHANGE_RATES_UPDATED, {
      provider,
      baseCurrency,
      rates,
      fetchedAt: snapshot.fetchedAt
    });
  } catch (err) {
    console.error('[ExchangeRate] Failed to broadcast rates:', err);
  }

  return snapshot;
}

/**
 * Refreshes latest exchange rates and caches them
 */
async function refreshRates() {
  try {
    const { provider, baseCurrency, rates, duration } = await fetchRatesFromProviders(BASE_CURRENCY);
    const snapshot = await saveSnapshot(provider, baseCurrency, rates, duration);
    console.log(`[ExchangeRate] Successfully cached exchange rates from ${provider}.`);
    return snapshot;
  } catch (err) {
    console.error('[ExchangeRate Error] Failed to refresh exchange rates:', err);
    throw err;
  }
}

/**
 * Get latest rates from memory, DB cache, or direct download
 */
async function getLatestRates() {
  // Check memory cache first (valid for 12 hours)
  if (inMemorySnapshot) {
    const age = Date.now() - new Date(inMemorySnapshot.fetchedAt).getTime();
    if (age < 12 * 60 * 60 * 1000) {
      return inMemorySnapshot;
    }
  }

  // Check DB cache next
  const dbSnapshot = await prisma.exchangeRateSnapshot.findFirst({
    where: { baseCurrency: BASE_CURRENCY },
    orderBy: { fetchedAt: 'desc' }
  });

  if (dbSnapshot) {
    const age = Date.now() - new Date(dbSnapshot.fetchedAt).getTime();
    if (age < 12 * 60 * 60 * 1000) {
      inMemorySnapshot = dbSnapshot;
      return dbSnapshot;
    }
  }

  // Cache expired or missing: try refreshing rates
  try {
    return await refreshRates();
  } catch (err) {
    // If provider fails, fallback to last available DB cache
    if (dbSnapshot) {
      console.warn('[ExchangeRate] Provider refresh failed, falling back to expired DB cache.');
      inMemorySnapshot = dbSnapshot;
      return dbSnapshot;
    }
    throw new Error('No valid exchange rates cache exists and provider APIs are currently offline.');
  }
}

/**
 * Core convert helper. Converts target currency amount to base currency amount using cached snapshot.
 * Stored exchangeRate = 1 / rates[targetCurrency] (how much base currency = 1 target unit).
 */
async function convert(amount, fromCurrency, toCurrency) {
  if (fromCurrency === toCurrency) return { amount, rate: 1.0 };

  const snapshot = await getLatestRates();
  const rates = snapshot.rates;

  if (!(fromCurrency in rates) || !(toCurrency in rates)) {
    throw new Error(`Unsupported currency conversion: ${fromCurrency} to ${toCurrency}`);
  }

  // Rate of converting from -> to: rates[to] / rates[from]
  // rates[to] represents how much of "to" currency equals 1 unit of BASE
  // rates[from] represents how much of "from" currency equals 1 unit of BASE
  const rate = rates[toCurrency] / rates[fromCurrency];
  const converted = Math.round(amount * rate);

  return {
    amount: converted,
    rate
  };
}

/**
 * Direct integer rounding converter using rates
 */
function convertAmount(amount, rate) {
  if (rate === 1.0) return amount;
  return Math.round(amount * rate);
}

/**
 * Historical rate lookup (looks up snapshot closest to date or falls back to latest)
 */
async function getHistoricalSnapshot(date) {
  const d = new Date(date);
  const snapshot = await prisma.exchangeRateSnapshot.findFirst({
    where: {
      baseCurrency: BASE_CURRENCY,
      fetchedAt: { lte: d }
    },
    orderBy: { fetchedAt: 'desc' }
  });

  if (snapshot) return snapshot;

  // Fallback to the absolute first record or current rates
  return prisma.exchangeRateSnapshot.findFirst({
    where: { baseCurrency: BASE_CURRENCY },
    orderBy: { fetchedAt: 'asc' }
  });
}

// 12-hour scheduler retry task wrapper
let retryTimer = null;
function runScheduledRefresh(retryDelayMinutes = null) {
  console.log('[Scheduler] Executing scheduled exchange rates refresh...');

  refreshRates()
    .then(() => {
      console.log('[Scheduler] Exchange rates successfully updated.');
    })
    .catch((err) => {
      console.error('[Scheduler Error] Exchange rates refresh failed.');
      // Fallback retry schedule: 1 minute, 5 minutes, 15 minutes
      let nextDelay = 1;
      if (retryDelayMinutes === 1) nextDelay = 5;
      else if (retryDelayMinutes === 5) nextDelay = 15;
      else if (retryDelayMinutes === 15) nextDelay = 15; // capped

      console.warn(`[Scheduler] Scheduling retry in ${nextDelay} minute(s)...`);
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = setTimeout(() => {
        runScheduledRefresh(nextDelay);
      }, nextDelay * 60 * 1000);
    });
}

module.exports = {
  getLatestRates,
  convert,
  refreshRates,
  getHistoricalSnapshot,
  convertAmount,
  runScheduledRefresh,
  SUPPORTED_CURRENCIES,
  BASE_CURRENCY
};
