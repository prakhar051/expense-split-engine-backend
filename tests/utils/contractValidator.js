/**
 * API Contract JSON Schema Validator Utility
 */

function validateContract(responseBody, type = 'success', options = {}) {
  // 1. Base structure checks
  if (typeof responseBody !== 'object' || responseBody === null) {
    throw new Error('API Contract Error: Response body is not a JSON object');
  }

  if (type === 'success') {
    if (responseBody.success !== true) {
      throw new Error(`API Contract Error: Expected success: true, got: ${JSON.stringify(responseBody)}`);
    }
  } else if (type === 'error') {
    if (responseBody.success !== false) {
      throw new Error(`API Contract Error: Expected success: false, got: ${JSON.stringify(responseBody)}`);
    }
    if (typeof responseBody.message !== 'string') {
      throw new Error('API Contract Error: Missing or invalid error message string');
    }
  } else if (type === 'pagination') {
    if (responseBody.success !== true) {
      throw new Error('API Contract Error: Pagination response success must be true');
    }
    if (!responseBody.pagination || typeof responseBody.pagination !== 'object') {
      throw new Error('API Contract Error: Missing nested pagination metadata object');
    }
    const p = responseBody.pagination;
    const requiredKeys = ['page', 'limit', 'totalCount', 'totalPages'];
    for (const key of requiredKeys) {
      if (typeof p[key] !== 'number') {
        throw new Error(`API Contract Error: Pagination key "${key}" must be a number`);
      }
    }
  }

  // 2. Options validation (e.g. check presence of specific keys)
  if (options.requiredKeys) {
    for (const key of options.requiredKeys) {
      if (responseBody[key] === undefined) {
        throw new Error(`API Contract Error: Required field "${key}" is missing from response`);
      }
    }
  }

  return true;
}

module.exports = { validateContract };
