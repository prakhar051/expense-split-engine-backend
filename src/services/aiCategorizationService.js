const crypto = require('crypto');
const { GoogleGenAI } = require('@google/genai');
const { z } = require('zod');
const { normalizeMerchant } = require('../utils/merchantNormalizer');

// Initialize Gemini client. It automatically uses process.env.GEMINI_API_KEY.
// If GEMINI_API_KEY is not defined, we set a placeholder key to avoid constructor startup crashes
if (!process.env.GEMINI_API_KEY) {
  process.env.GEMINI_API_KEY = 'AIzaSyDummyKeyPlaceholderForDevAndTesting';
}
const ai = new GoogleGenAI({});

const PROMPT_VERSION = 'v1';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

// In-memory cache map
const cache = new Map();

// Zod Schema to validate response format
const aiResponseSchema = z.object({
  merchant: z.string().max(100).nullable(),
  title: z.string().min(3).max(100),
  category: z.enum(['FOOD', 'TRAVEL', 'RENT', 'UTILITIES', 'SHOPPING', 'ENTERTAINMENT', 'GENERAL']),
  confidence: z.number().int().min(0).max(100),
  reason: z.string()
});

const DEFAULT_FALLBACK = {
  merchant: null,
  title: "Receipt Expense",
  category: "GENERAL",
  confidence: 0,
  reason: "AI categorization unavailable."
};

/**
 * Computes SHA256 of rawText + prompt version
 */
const getCacheKey = (rawText) => {
  return crypto
    .createHash('sha256')
    .update(rawText + PROMPT_VERSION)
    .digest('hex');
};

/**
 * Trims whitespace and collapses repeated blank lines
 */
const sanitizeInput = (text) => {
  if (!text) return '';
  return text.trim().replace(/\n\s*\n/g, '\n');
};

/**
 * Call Gemini 2.5 Flash to categorize a receipt.
 *
 * @param {string} rawText - OCR extracted raw text
 * @param {string} userId - Requesting user ID for activity logging
 * @returns {Promise<Object>} Formatted AI suggestions or fallbacks
 */
const categorizeReceipt = async (rawText, userId) => {
  const startTime = Date.now();
  console.log('[AI Service] Request start');

  const sanitizedText = sanitizeInput(rawText);

  // Fallback if raw text is empty
  if (!sanitizedText) {
    console.log('[AI Service] Empty rawText. Returning fallback.');
    return {
      success: true,
      fromCache: false,
      model: 'gemini-2.5-flash',
      processingTimeMs: Date.now() - startTime,
      suggestion: DEFAULT_FALLBACK
    };
  }

  // Reject text larger than 15,000 characters
  if (sanitizedText.length > 15000) {
    console.log('[AI Service] rawText exceeds 15,000 characters. Returning fallback.');
    return {
      success: true,
      fromCache: false,
      model: 'gemini-2.5-flash',
      processingTimeMs: Date.now() - startTime,
      suggestion: DEFAULT_FALLBACK
    };
  }

  // Cache hit lookup
  const cacheKey = getCacheKey(sanitizedText);
  const cached = cache.get(cacheKey);
  if (cached) {
    const age = Date.now() - cached.timestamp;
    if (age < CACHE_TTL_MS) {
      console.log('[AI Service] Cache hit');
      const processingTime = Date.now() - startTime;
      
      try {
        const { logActivity } = require('./activityService');
        await logActivity(userId, 'AI_RECEIPT_ANALYZED', `AI analyzed receipt for merchant: ${cached.data.merchant || 'Unknown'} (from cache).`, null, {
          merchant: cached.data.merchant,
          category: cached.data.category,
          confidence: cached.data.confidence,
          processingTime
        });
      } catch (err) {
        console.error('[AI Service] Failed to log activity for cache hit:', err);
      }

      return {
        success: true,
        fromCache: true,
        model: 'gemini-2.5-flash',
        processingTimeMs: processingTime,
        suggestion: cached.data
      };
    } else {
      console.log('[AI Service] Cache expired');
      cache.delete(cacheKey);
    }
  }

  const prompt = `You are a strict expense categorization engine.
Given the OCR receipt text below, determine:
- merchant: The business/store name (e.g. Starbucks, Uber, Walmart).
- title: A short description of the expense (e.g. "Coffee & Snacks", "Cab Ride", "Grocery shopping").
- category: The standard expense category.
- confidence: Your confidence score from 0 to 100 as an integer.
- reason: A concise explanation for your classification.

Allowed categories strictly:
- FOOD
- TRAVEL
- RENT
- UTILITIES
- SHOPPING
- ENTERTAINMENT
- GENERAL

Important constraints:
- Do NOT calculate amount, tax, currency, or transaction date.
- Return ONLY valid JSON matching the schema. No markdown backticks.

OCR Receipt Text:
${sanitizedText}`;

  const executeGeminiCall = async () => {
    console.log('[AI Service] Gemini call');
    const result = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'OBJECT',
          properties: {
            merchant: { type: 'STRING' },
            title: { type: 'STRING' },
            category: { type: 'STRING' },
            confidence: { type: 'INTEGER' },
            reason: { type: 'STRING' }
          },
          required: ['merchant', 'title', 'category', 'confidence', 'reason']
        }
      }
    });
    return result.text;
  };

  const doWork = async () => {
    let attempt = 0;
    let responseText = null;

    while (attempt < 2) {
      try {
        attempt++;
        responseText = await executeGeminiCall();
        break; 
      } catch (err) {
        console.error(`[AI Service] Attempt ${attempt} failed:`, err.message);

        // Retry ONLY once for HTTP 5xx errors
        const is5xx = err.status >= 500 && err.status < 600 || err.message.includes('500') || err.message.includes('503');
        if (attempt === 1 && is5xx) {
          console.log('[AI Service] Retrying HTTP 5xx error...');
          continue;
        }
        break;
      }
    }

    if (!responseText) {
      throw new Error('Gemini API returned empty responseText');
    }

    const rawJson = JSON.parse(responseText);
    const validated = aiResponseSchema.parse(rawJson);
    validated.merchant = normalizeMerchant(validated.merchant);
    
    console.log('[AI Service] Validation success');
    const processingTime = Date.now() - startTime;

    // Cache successful validated responses only
    cache.set(cacheKey, {
      data: validated,
      timestamp: Date.now()
    });

    // Log Activity
    try {
      const { logActivity } = require('./activityService');
      await logActivity(userId, 'AI_RECEIPT_ANALYZED', `AI analyzed receipt for merchant: ${validated.merchant || 'Unknown'}.`, null, {
        merchant: validated.merchant,
        category: validated.category,
        confidence: validated.confidence,
        processingTime
      });
    } catch (err) {
      console.error('[AI Service] Failed to log activity:', err);
    }

    return {
      success: true,
      fromCache: false,
      model: 'gemini-2.5-flash',
      processingTimeMs: processingTime,
      suggestion: validated
    };
  };

  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('AI categorization timeout')), 10000)
  );

  try {
    return await Promise.race([doWork(), timeoutPromise]);
  } catch (err) {
    console.error('[AI Service] Error or Timeout during execution:', err.message);
    return {
      success: true,
      fromCache: false,
      model: 'gemini-2.5-flash',
      processingTimeMs: Date.now() - startTime,
      suggestion: DEFAULT_FALLBACK
    };
  }
};

module.exports = {
  categorizeReceipt,
  clearCache: () => cache.clear()
};
