// Enforce a dummy API key so the GoogleGenAI constructor initializes in API Key mode instead of ADC
process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'AIzaSyDummyKeyForTestingChecks';

const crypto = require('crypto');
const prisma = require('./prisma');
const { GoogleGenAI } = require('@google/genai');

// Overwrite the generateContentInternal function on the Models class prototype
const aiInstance = new GoogleGenAI({});
const ModelsClass = aiInstance.models.constructor;

let currentMockBehavior = null;

ModelsClass.prototype.generateContentInternal = async function (args) {
  if (!currentMockBehavior) {
    throw new Error("Mock generateContent behavior not set");
  }
  return currentMockBehavior(args);
};

const aiCategorizationService = require('../services/aiCategorizationService');

const BASE_URL = 'http://localhost:5000/api';

async function apiRequest(path, method = 'GET', body = null, token = null) {
  const url = `${BASE_URL}${path}`;
  const headers = { 'Content-Type': 'application/json' };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const options = { method, headers };
  if (body) {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(url, options);
  const data = await response.json();

  if (!response.ok) {
    const error = new Error(data.message || `Request failed with status ${response.status}`);
    error.status = response.status;
    error.data = data;
    throw error;
  }

  return data;
}

async function run() {
  console.log('================================================================');
  console.log('PHASE 21 INTEGRATION & UNIT VERIFICATION CHECKS');
  console.log('================================================================\n');

  const timestamp = Date.now();
  let token = null;
  let testUser = null;

  // Setup test user
  try {
    console.log('--- Step 0: Creating test user ---');
    const email = `ai_test_${timestamp}@example.com`;
    const regRes = await apiRequest('/auth/register', 'POST', {
      email,
      password: 'Password123',
      name: 'AI Test User'
    });
    testUser = regRes.user;

    const loginRes = await apiRequest('/auth/login', 'POST', {
      email,
      password: 'Password123'
    });
    token = loginRes.accessToken;
    console.log(`   User registered and logged in. ID: ${testUser.id}`);
    console.log('Result: PASS\n');
  } catch (err) {
    console.error('Test user setup failed. Make sure the backend server is running on http://localhost:5000.', err.message);
    process.exit(1);
  }

  // 1. Starbucks Receipt
  try {
    console.log('--- Test 1: Starbucks receipt ---');
    currentMockBehavior = async () => ({
      text: JSON.stringify({
        merchant: 'STARBUCKS STORE 101',
        title: 'Coffee & Snacks',
        category: 'FOOD',
        confidence: 96,
        reason: 'Coffee shop items detected.'
      })
    });

    const res = await aiCategorizationService.categorizeReceipt('Welcome to Starbucks! Coffee $4.50', testUser.id);
    console.log('Output:', JSON.stringify(res.suggestion, null, 2));
    if (res.suggestion.merchant !== 'Starbucks' || res.suggestion.category !== 'FOOD' || res.suggestion.confidence !== 96) {
      throw new Error('Starbucks suggestion mismatch or normalization failed');
    }
    console.log('Result: PASS\n');
  } catch (err) {
    console.error('Test 1 failed:', err);
    process.exit(1);
  }

  // 2. Uber Receipt
  try {
    console.log('--- Test 2: Uber receipt ---');
    currentMockBehavior = async () => ({
      text: JSON.stringify({
        merchant: 'UBER BV',
        title: 'Ride in city',
        category: 'TRAVEL',
        confidence: 95,
        reason: 'Rideshare service ride.'
      })
    });

    const res = await aiCategorizationService.categorizeReceipt('Uber ride receipt. $15.20', testUser.id);
    console.log('Output:', JSON.stringify(res.suggestion, null, 2));
    if (res.suggestion.merchant !== 'Uber' || res.suggestion.category !== 'TRAVEL') {
      throw new Error('Uber suggestion mismatch');
    }
    console.log('Result: PASS\n');
  } catch (err) {
    console.error('Test 2 failed:', err);
    process.exit(1);
  }

  // 3. Walmart Receipt
  try {
    console.log('--- Test 3: Walmart receipt ---');
    currentMockBehavior = async () => ({
      text: JSON.stringify({
        merchant: 'WALMART SUPERCENTER',
        title: 'Groceries and snacks',
        category: 'SHOPPING',
        confidence: 92,
        reason: 'Walmart purchase receipt.'
      })
    });

    const res = await aiCategorizationService.categorizeReceipt('Walmart store receipt. $32.40', testUser.id);
    console.log('Output:', JSON.stringify(res.suggestion, null, 2));
    if (res.suggestion.merchant !== 'Walmart' || res.suggestion.category !== 'SHOPPING') {
      throw new Error('Walmart suggestion mismatch');
    }
    console.log('Result: PASS\n');
  } catch (err) {
    console.error('Test 3 failed:', err);
    process.exit(1);
  }

  // 4. Hotel Receipt
  try {
    console.log('--- Test 4: Hotel receipt ---');
    currentMockBehavior = async () => ({
      text: JSON.stringify({
        merchant: 'HILTON HOTELS',
        title: 'Room reservation',
        category: 'TRAVEL',
        confidence: 90,
        reason: 'Hotel accommodation lodging.'
      })
    });

    const res = await aiCategorizationService.categorizeReceipt('Hilton Hotel checkout receipt. $250.00', testUser.id);
    console.log('Output:', JSON.stringify(res.suggestion, null, 2));
    if (res.suggestion.merchant !== 'HILTON HOTELS' || res.suggestion.category !== 'TRAVEL') {
      throw new Error('Hotel suggestion mismatch');
    }
    console.log('Result: PASS\n');
  } catch (err) {
    console.error('Test 4 failed:', err);
    process.exit(1);
  }

  // 5. Unknown Receipt
  try {
    console.log('--- Test 5: Unknown receipt ---');
    currentMockBehavior = async () => ({
      text: JSON.stringify({
        merchant: 'SOMETHING STRANGE',
        title: 'Random items',
        category: 'GENERAL',
        confidence: 50,
        reason: 'Unidentified receipt.'
      })
    });

    const res = await aiCategorizationService.categorizeReceipt('Random purchase details. $80.00', testUser.id);
    console.log('Output:', JSON.stringify(res.suggestion, null, 2));
    if (res.suggestion.category !== 'GENERAL') {
      throw new Error('Unknown receipt should map to GENERAL');
    }
    console.log('Result: PASS\n');
  } catch (err) {
    console.error('Test 5 failed:', err);
    process.exit(1);
  }

  // 6. Empty OCR text
  try {
    console.log('--- Test 6: Empty OCR text ---');
    const res = await aiCategorizationService.categorizeReceipt('', testUser.id);
    console.log('Output:', JSON.stringify(res.suggestion, null, 2));
    if (res.suggestion.category !== 'GENERAL' || res.suggestion.confidence !== 0) {
      throw new Error('Empty OCR text should return fallback immediately');
    }
    console.log('Result: PASS\n');
  } catch (err) {
    console.error('Test 6 failed:', err);
    process.exit(1);
  }

  // 7. Whitespace OCR text
  try {
    console.log('--- Test 7: Whitespace OCR text ---');
    const res = await aiCategorizationService.categorizeReceipt('   \n  \n   ', testUser.id);
    console.log('Output:', JSON.stringify(res.suggestion, null, 2));
    if (res.suggestion.category !== 'GENERAL' || res.suggestion.confidence !== 0) {
      throw new Error('Whitespace OCR text should return fallback immediately');
    }
    console.log('Result: PASS\n');
  } catch (err) {
    console.error('Test 7 failed:', err);
    process.exit(1);
  }

  // 8. OCR > 15,000 characters
  try {
    console.log('--- Test 8: OCR > 15000 chars ---');
    const largeOcr = 'A'.repeat(15005);
    const res = await aiCategorizationService.categorizeReceipt(largeOcr, testUser.id);
    console.log('Output:', JSON.stringify(res.suggestion, null, 2));
    if (res.suggestion.category !== 'GENERAL' || res.suggestion.confidence !== 0) {
      throw new Error('Oversized OCR text should return fallback immediately');
    }
    console.log('Result: PASS\n');
  } catch (err) {
    console.error('Test 8 failed:', err);
    process.exit(1);
  }

  // 9. Malformed JSON Response
  try {
    console.log('--- Test 9: Malformed JSON response ---');
    currentMockBehavior = async () => ({
      text: '{ malformed json string }'
    });

    const res = await aiCategorizationService.categorizeReceipt('Malformed JSON Test', testUser.id);
    console.log('Output:', JSON.stringify(res.suggestion, null, 2));
    if (res.suggestion.category !== 'GENERAL' || res.suggestion.confidence !== 0 || res.suggestion.reason !== 'AI categorization unavailable.') {
      throw new Error('Malformed JSON should fallback gracefully');
    }
    console.log('Result: PASS\n');
  } catch (err) {
    console.error('Test 9 failed:', err);
    process.exit(1);
  }

  // 10. Timeout (10 seconds)
  try {
    console.log('--- Test 10: Gemini API Timeout ---');
    currentMockBehavior = async () => {
      await new Promise(r => setTimeout(r, 11000)); // Delay 11s, exceeding 10s timeout
      return { text: '{}' };
    };

    const startTime = Date.now();
    const res = await aiCategorizationService.categorizeReceipt('Timeout testing text', testUser.id);
    const duration = Date.now() - startTime;
    console.log(`   Response returned after ${duration}ms.`);
    console.log('Output:', JSON.stringify(res.suggestion, null, 2));
    if (res.suggestion.category !== 'GENERAL' || duration > 10500) {
      throw new Error('Timeout did not return fallback or exceeded 10 seconds');
    }
    console.log('Result: PASS\n');
  } catch (err) {
    console.error('Test 10 failed:', err);
    process.exit(1);
  }

  // 11. HTTP 500 retry
  try {
    console.log('--- Test 11: HTTP 500 Retry logic ---');
    let callCount = 0;
    currentMockBehavior = async () => {
      callCount++;
      if (callCount === 1) {
        const err = new Error('Internal Server Error');
        err.status = 500;
        throw err;
      }
      return {
        text: JSON.stringify({
          merchant: 'McDonalds India',
          title: 'Happy Meal',
          category: 'FOOD',
          confidence: 88,
          reason: 'Food item description.'
        })
      };
    };

    const res = await aiCategorizationService.categorizeReceipt('Retry testing content', testUser.id);
    console.log('Output:', JSON.stringify(res.suggestion, null, 2));
    console.log(`   Generate content was called ${callCount} times.`);
    if (callCount !== 2 || res.suggestion.merchant !== "McDonald's") {
      throw new Error('Retry logic failed to retry on HTTP 500 or normalize result');
    }
    console.log('Result: PASS\n');
  } catch (err) {
    console.error('Test 11 failed:', err);
    process.exit(1);
  }

  // 12. HTTP 429
  try {
    console.log('--- Test 12: HTTP 429 No Retry ---');
    let callCount = 0;
    currentMockBehavior = async () => {
      callCount++;
      const err = new Error('Resource exhausted');
      err.status = 429;
      throw err;
    };

    const res = await aiCategorizationService.categorizeReceipt('No retry 429 testing', testUser.id);
    console.log('Output:', JSON.stringify(res.suggestion, null, 2));
    console.log(`   Generate content was called ${callCount} times.`);
    if (callCount !== 1 || res.suggestion.category !== 'GENERAL') {
      throw new Error('Rate limit error should not trigger retries');
    }
    console.log('Result: PASS\n');
  } catch (err) {
    console.error('Test 12 failed:', err);
    process.exit(1);
  }

  // 13. Invalid API Key (HTTP 401)
  try {
    console.log('--- Test 13: HTTP 401 Invalid API Key ---');
    let callCount = 0;
    currentMockBehavior = async () => {
      callCount++;
      const err = new Error('API key not valid');
      err.status = 401;
      throw err;
    };

    const res = await aiCategorizationService.categorizeReceipt('Invalid API Key', testUser.id);
    console.log('Output:', JSON.stringify(res.suggestion, null, 2));
    if (callCount !== 1 || res.suggestion.category !== 'GENERAL') {
      throw new Error('Auth failure should immediately trigger fallback without retries');
    }
    console.log('Result: PASS\n');
  } catch (err) {
    console.error('Test 13 failed:', err);
    process.exit(1);
  }

  // 14. Unknown Category Whitelist validation
  try {
    console.log('--- Test 14: Unknown Category whitelist rejection ---');
    currentMockBehavior = async () => ({
      text: JSON.stringify({
        merchant: 'CLOTHING STORE',
        title: 'New jacket',
        category: 'CLOTHES', // Invalid category!
        confidence: 90,
        reason: 'Bought apparel.'
      })
    });

    const res = await aiCategorizationService.categorizeReceipt('Whitelist category validation', testUser.id);
    console.log('Output:', JSON.stringify(res.suggestion, null, 2));
    if (res.suggestion.category !== 'GENERAL' || res.suggestion.confidence !== 0) {
      throw new Error('Non-whitelisted category should fail schema validation and fallback');
    }
    console.log('Result: PASS\n');
  } catch (err) {
    console.error('Test 14 failed:', err);
    process.exit(1);
  }

  // 15. Invalid Confidence Out of Bounds (Zod validation check)
  try {
    console.log('--- Test 15: Invalid confidence boundaries rejection ---');
    currentMockBehavior = async () => ({
      text: JSON.stringify({
        merchant: 'Bookstore',
        title: 'Study books',
        category: 'SHOPPING',
        confidence: 150, // Invalid! Max is 100
        reason: 'Too confident.'
      })
    });

    const res = await aiCategorizationService.categorizeReceipt('Confidence bounds validation', testUser.id);
    console.log('Output:', JSON.stringify(res.suggestion, null, 2));
    if (res.suggestion.confidence !== 0 || res.suggestion.category !== 'GENERAL') {
      throw new Error('Confidence outside 0-100 must fail validation and fallback');
    }
    console.log('Result: PASS\n');
  } catch (err) {
    console.error('Test 15 failed:', err);
    process.exit(1);
  }

  // 16. Merchant normalization checks
  try {
    console.log('--- Test 16: Merchant normalizations mapping ---');
    const normalizeMerchant = require('../utils/merchantNormalizer').normalizeMerchant;
    const testCases = [
      { raw: 'STARBUCKS STORE 101', expected: 'Starbucks' },
      { raw: 'UBER BV', expected: 'Uber' },
      { raw: 'MCDONALDS INDIA', expected: "McDonald's" },
      { raw: 'WALMART SUPERCENTER', expected: 'Walmart' },
      { raw: 'AMAZON RETAIL', expected: 'Amazon' },
      { raw: 'SHELL PETROL', expected: 'Shell' },
      { raw: 'Random Store', expected: 'Random Store' }
    ];

    for (const testCase of testCases) {
      const normalized = normalizeMerchant(testCase.raw);
      console.log(`   Raw: "${testCase.raw}" ➔ Normalized: "${normalized}"`);
      if (normalized !== testCase.expected) {
        throw new Error(`Normalization failed for ${testCase.raw}. Expected ${testCase.expected}, got ${normalized}`);
      }
    }
    console.log('Result: PASS\n');
  } catch (err) {
    console.error('Test 16 failed:', err);
    process.exit(1);
  }

  // 17. Cache hit checks
  try {
    console.log('--- Test 17: Cache Hit check ---');
    aiCategorizationService.clearCache(); // Reset cache

    let callCount = 0;
    currentMockBehavior = async () => {
      callCount++;
      return {
        text: JSON.stringify({
          merchant: 'AMAZON RETAIL',
          title: 'Kindle Book',
          category: 'SHOPPING',
          confidence: 94,
          reason: 'E-book buy.'
        })
      };
    };

    const rawText = 'Unique receipt text for caching';
    
    // First call: goes to Gemini
    const res1 = await aiCategorizationService.categorizeReceipt(rawText, testUser.id);
    console.log('   First Call fromCache:', res1.fromCache);
    
    // Second call: loads from cache
    const res2 = await aiCategorizationService.categorizeReceipt(rawText, testUser.id);
    console.log('   Second Call fromCache:', res2.fromCache);

    if (res1.fromCache !== false || res2.fromCache !== true || callCount !== 1) {
      throw new Error('Cache hit failed to retrieve from memory or made redundant API call');
    }
    console.log('Result: PASS\n');
  } catch (err) {
    console.error('Test 17 failed:', err);
    process.exit(1);
  }

  // 18. Cache Expiration checks
  try {
    console.log('--- Test 18: Cache Expiration check ---');
    aiCategorizationService.clearCache();

    let callCount = 0;
    currentMockBehavior = async () => {
      callCount++;
      return {
        text: JSON.stringify({
          merchant: 'Starbucks',
          title: 'Coffee',
          category: 'FOOD',
          confidence: 90,
          reason: 'Drink.'
        })
      };
    };

    const text = 'Cache expiration text';
    await aiCategorizationService.categorizeReceipt(text, testUser.id);

    // Mock Date.now to simulate shifting time forward by 25 hours (TTL is 24 hours)
    const originalNow = Date.now;
    Date.now = () => originalNow() + (25 * 60 * 60 * 1000);

    const res = await aiCategorizationService.categorizeReceipt(text, testUser.id);
    
    // Restore clock
    Date.now = originalNow;

    console.log('   After 25 hours fromCache:', res.fromCache);
    if (res.fromCache !== false || callCount !== 2) {
      throw new Error('Expired cache entry was incorrectly reused');
    }
    console.log('Result: PASS\n');
  } catch (err) {
    console.error('Test 18 failed:', err);
    process.exit(1);
  }

  // 19. Rate limiting (20 requests per minute)
  try {
    console.log('--- Test 19: Rate Limiting E2E check ---');
    console.log('   Sending 22 requests to verify rate limiter locks after 20...');
    
    let isLocked = false;
    
    // Execute 22 sequential requests to the live server
    for (let i = 1; i <= 22; i++) {
      try {
        await apiRequest('/ai/categorize-receipt', 'POST', {
          rawText: `Rate limit test text ${i}`
        }, token);
      } catch (err) {
        if (err.status === 429) {
          isLocked = true;
          console.log(`   Locked successfully on call ${i} with 429 (Expected)`);
          break;
        }
        throw err;
      }
    }

    if (!isLocked) {
      throw new Error('Rate limiter failed to block after 20 requests per minute');
    }
    console.log('Result: PASS\n');
  } catch (err) {
    console.error('Test 19 failed:', err);
    process.exit(1);
  }

  // 20. 10 Concurrent requests
  try {
    console.log('--- Test 20: Concurrent requests handling ---');
    // Using a different token / user to avoid rate limiter triggers
    const registerTemp = await apiRequest('/auth/register', 'POST', {
      email: `temp_${timestamp}@example.com`,
      password: 'Password123',
      name: 'Temp User'
    });
    const loginTemp = await apiRequest('/auth/login', 'POST', {
      email: `temp_${timestamp}@example.com`,
      password: 'Password123'
    });
    const tempToken = loginTemp.accessToken;

    currentMockBehavior = async (args) => {
      // Mock returns different values or same
      return {
        text: JSON.stringify({
          merchant: 'Uber',
          title: 'Ride',
          category: 'TRAVEL',
          confidence: 90,
          reason: 'Rideshare.'
        })
      };
    };

    const promises = [];
    for (let i = 0; i < 10; i++) {
      promises.push(
        apiRequest('/ai/categorize-receipt', 'POST', {
          rawText: `Concurrent test text ${i}`
        }, tempToken)
      );
    }

    const results = await Promise.all(promises);
    console.log(`   Successfully resolved ${results.length} concurrent requests.`);
    if (results.length !== 10) {
      throw new Error('Failed to resolve all 10 concurrent requests');
    }
    console.log('Result: PASS\n');
  } catch (err) {
    console.error('Test 20 failed:', err);
    process.exit(1);
  }

  // 21. Unicode OCR text
  try {
    console.log('--- Test 21: Unicode character support ---');
    currentMockBehavior = async () => ({
      text: JSON.stringify({
        merchant: 'Café Paris ☕',
        title: 'Croissant 🥐 Buy',
        category: 'FOOD',
        confidence: 99,
        reason: 'Unicode characters cafe.'
      })
    });

    const res = await aiCategorizationService.categorizeReceipt('Café Paris ☕ Croissant 🥐 Buy', testUser.id);
    console.log('Output:', JSON.stringify(res.suggestion, null, 2));
    if (res.suggestion.merchant !== 'Café Paris ☕' || res.suggestion.category !== 'FOOD') {
      throw new Error('Unicode receipt details mismatch');
    }
    console.log('Result: PASS\n');
  } catch (err) {
    console.error('Test 21 failed:', err);
    process.exit(1);
  }

  // 22. Activity log creation
  try {
    console.log('--- Test 22: Activity logs DB creation ---');
    const logs = await prisma.activity.findMany({
      where: { userId: testUser.id, type: 'AI_RECEIPT_ANALYZED' }
    });
    console.log(`   Found ${logs.length} AI_RECEIPT_ANALYZED logs in Prisma.`);
    if (logs.length === 0) {
      throw new Error('No activity log entries found for AI receipt analysis');
    }
    const meta = logs[0].metadata;
    console.log('   Log Metadata:', JSON.stringify(meta));
    if (!meta.merchant || !meta.category || !meta.confidence || !meta.processingTime) {
      throw new Error('Activity log metadata is missing fields');
    }
    console.log('Result: PASS\n');
  } catch (err) {
    console.error('Test 22 failed:', err);
    process.exit(1);
  }

  // 23. Processing time check
  try {
    console.log('--- Test 23: Processing time check ---');
    currentMockBehavior = async () => ({
      text: JSON.stringify({
        merchant: 'Shell Petrol',
        title: 'Fuel',
        category: 'TRAVEL',
        confidence: 90,
        reason: 'Gas station.'
      })
    });

    const res = await aiCategorizationService.categorizeReceipt('Shell gas station fuel. $45.00', testUser.id);
    console.log(`   processingTimeMs: ${res.processingTimeMs}ms`);
    if (typeof res.processingTimeMs !== 'number' || res.processingTimeMs < 0) {
      throw new Error('processingTimeMs must be a positive number');
    }
    console.log('Result: PASS\n');
  } catch (err) {
    console.error('Test 23 failed:', err);
    process.exit(1);
  }

  // 24. Fallback checking
  try {
    console.log('--- Test 24: Default fallback validation ---');
    currentMockBehavior = async () => {
      throw new Error('Quota exceeded or network offline');
    };

    const res = await aiCategorizationService.categorizeReceipt('Trigger fallback error', testUser.id);
    console.log('Output:', JSON.stringify(res.suggestion, null, 2));
    if (res.suggestion.category !== 'GENERAL' || res.suggestion.confidence !== 0 || res.suggestion.merchant !== null || res.suggestion.title !== 'Receipt Expense') {
      throw new Error('Fallback response is incorrect');
    }
    console.log('Result: PASS\n');
  } catch (err) {
    console.error('Test 24 failed:', err);
    process.exit(1);
  }

  console.log('================================================================');
  console.log('ALL PHASE 21 INTEGRATION CHECKS PASSED SUCCESSFULLY!');
  console.log('================================================================');
}

run();
