const rateService = require('../services/exchangeRateService');
const prisma = require('../utils/prisma');

/**
 * Get latest exchange rates
 */
const getLatestRates = async (req, res, next) => {
  try {
    const snapshot = await rateService.getLatestRates();
    res.status(200).json({
      success: true,
      baseCurrency: snapshot.baseCurrency,
      provider: snapshot.provider,
      rates: snapshot.rates,
      fetchedAt: snapshot.fetchedAt
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Get supported currencies list
 */
const getSupportedCurrencies = async (req, res, next) => {
  try {
    res.status(200).json({
      success: true,
      currencies: rateService.SUPPORTED_CURRENCIES,
      baseCurrency: rateService.BASE_CURRENCY
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Convert amount from one currency to another
 */
const convertAmount = async (req, res, next) => {
  const { amount, from, to } = req.body;
  
  if (amount === undefined || !from || !to) {
    return res.status(400).json({
      success: false,
      message: 'amount, from, and to parameters are required.'
    });
  }

  const parsedAmount = parseInt(amount, 10);
  if (isNaN(parsedAmount) || parsedAmount < 0) {
    return res.status(400).json({
      success: false,
      message: 'amount must be a non-negative integer.'
    });
  }

  if (!rateService.SUPPORTED_CURRENCIES.includes(from) || !rateService.SUPPORTED_CURRENCIES.includes(to)) {
    return res.status(400).json({
      success: false,
      message: `Unsupported currency codes. Supported list: ${rateService.SUPPORTED_CURRENCIES.join(', ')}`
    });
  }

  try {
    const result = await rateService.convert(parsedAmount, from, to);
    res.status(200).json({
      success: true,
      originalAmount: parsedAmount,
      convertedAmount: result.amount,
      rate: result.rate,
      from,
      to
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Get historical rate trends
 */
const getHistoricalRates = async (req, res, next) => {
  try {
    const snapshots = await prisma.exchangeRateSnapshot.findMany({
      where: { baseCurrency: rateService.BASE_CURRENCY },
      orderBy: { fetchedAt: 'desc' },
      take: 50
    });
    res.status(200).json({
      success: true,
      history: snapshots
    });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  getLatestRates,
  getSupportedCurrencies,
  convertAmount,
  getHistoricalRates
};
