/**
 * Normalizes merchant names based on case-insensitive brand keywords.
 *
 * @param {string|null} name - Raw merchant name
 * @returns {string|null} Normalized merchant name
 */
const normalizeMerchant = (name) => {
  if (!name) return null;
  const trimmed = name.trim();
  if (!trimmed) return null;

  const lower = trimmed.toLowerCase();

  if (lower.includes('starbucks')) return 'Starbucks';
  if (lower.includes('uber')) return 'Uber';
  if (lower.includes('mcdonald')) return "McDonald's";
  if (lower.includes('walmart')) return 'Walmart';
  if (lower.includes('amazon')) return 'Amazon';
  if (lower.includes('shell')) return 'Shell';

  return trimmed;
};

module.exports = {
  normalizeMerchant
};
