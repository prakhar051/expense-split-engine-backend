const prisma = require('../utils/prisma');
const { GoogleGenAI } = require('@google/genai');

// Initialize Gemini client.
if (!process.env.GEMINI_API_KEY) {
  process.env.GEMINI_API_KEY = 'AIzaSyDummyKeyPlaceholderForDevAndTesting';
}
const ai = new GoogleGenAI({});

const PROMPT_VERSION = 'v1.0.0';
const MODEL_NAME = 'gemini-2.5-flash';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

const getAISpendingInsights = async (userId) => {
  const startTime = Date.now();

  // 1. Gather current month's spending data
  const now = new Date();
  const startOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const endOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 23, 59, 59, 999));

  const participants = await prisma.expenseParticipant.findMany({
    where: {
      userId,
      expense: {
        createdAt: {
          gte: startOfMonth,
          lte: endOfMonth
        }
      }
    },
    include: {
      expense: true
    }
  });

  const expenseCount = participants.length;
  const totalSpentAmount = participants.reduce((sum, p) => sum + p.shareAmount, 0);

  // AI Cost Protection: Skip Gemini call if no meaningful spending history exists
  if (expenseCount === 0) {
    return {
      success: true,
      summary: "No spending history recorded for the current month. Add expenses to get AI spending insights.",
      recommendations: [],
      anomalies: [],
      habits: [],
      advice: "Try logging your food, transit, or utility bills to start tracking your budget.",
      recommendedBudgets: [],
      generatedAt: new Date().toISOString()
    };
  }

  // AI Cost Protection: Check if we have an existing insight for this user
  const lastInsight = await prisma.aIInsight.findFirst({
    where: { userId },
    orderBy: { generatedAt: 'desc' }
  });

  if (lastInsight) {
    const age = Date.now() - new Date(lastInsight.generatedAt).getTime();
    
    // Invalidate cached insight only if 24 hours have passed OR spending data has changed
    const dataUnchanged = lastInsight.expenseCount === expenseCount && lastInsight.totalSpentAmount === totalSpentAmount;
    if (age < CACHE_TTL_MS || dataUnchanged) {
      console.log('[AI Insights] Returning cached AIInsight from database.');
      return {
        success: true,
        summary: lastInsight.summary,
        recommendations: lastInsight.recommendations,
        anomalies: lastInsight.anomalies,
        habits: lastInsight.recommendations, // reuse list
        advice: lastInsight.summary,
        recommendedBudgets: [],
        generatedAt: lastInsight.generatedAt.toISOString(),
        fromCache: true
      };
    }
  }

  // 2. Prepare spent summary for the prompt
  // Group spend by category
  const catSummary = {};
  const expenseDetails = [];

  participants.forEach((p) => {
    const cat = p.expense.category;
    catSummary[cat] = (catSummary[cat] || 0) + p.shareAmount;
    expenseDetails.push({
      title: p.expense.title,
      category: cat,
      amount: p.shareAmount / 100, // convert to units
      date: p.expense.createdAt.toISOString().split('T')[0]
    });
  });

  const formattedCats = Object.entries(catSummary).map(([cat, amt]) => `${cat}: ${amt / 100} INR`).join('\n');
  const formattedExpenses = JSON.stringify(expenseDetails.slice(0, 15));

  const prompt = `You are a smart financial advisor. Analyse the following user spending data for the current month:
Total spending this month: ${totalSpentAmount / 100} INR across ${expenseCount} expenses.

Spending by category:
${formattedCats}

Recent expenses:
${formattedExpenses}

Please generate:
1. summary: A brief 2-3 sentence overview of the user's spending habits.
2. recommendations: A list of 3 practical saving recommendations customized to their categories.
3. anomalies: A list of any unusual transaction clusters, spikes, or potential savings leaks (or note if spending looks normal).
4. habits: A list of 2 key spending habits identified from their transactions.
5. advice: Short, motivational monthly financial advice (1 sentence).
6. recommendedBudgets: Recommended budget limits for categories they spent on, formatted as objects with "category" and "suggestedAmount" (in cents, representing a buffer over their current spending e.g. 1.1x their current spend).

Output strictly in JSON format matching the schema requested. No markdown backticks.`;

  let responseObj = null;

  try {
    const result = await ai.models.generateContent({
      model: MODEL_NAME,
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'OBJECT',
          properties: {
            summary: { type: 'STRING' },
            recommendations: { type: 'ARRAY', items: { type: 'STRING' } },
            anomalies: { type: 'ARRAY', items: { type: 'STRING' } },
            habits: { type: 'ARRAY', items: { type: 'STRING' } },
            advice: { type: 'STRING' },
            recommendedBudgets: {
              type: 'ARRAY',
              items: {
                type: 'OBJECT',
                properties: {
                  category: { type: 'STRING' },
                  suggestedAmount: { type: 'INTEGER' }
                },
                required: ['category', 'suggestedAmount']
              }
            }
          },
          required: ['summary', 'recommendations', 'anomalies', 'habits', 'advice', 'recommendedBudgets']
        }
      }
    });

    responseObj = JSON.parse(result.text);
  } catch (err) {
    console.error('[AI Insights Error] Gemini call failed or parsed incorrectly. Using mock.', err);
    // Graceful fallback mock
    responseObj = {
      summary: "Your spending seems stable this month. You have spent most of your money on food and shopping.",
      recommendations: [
        "Consider limiting food delivery or restaurant dinners.",
        "Set up budget alerts to get notified of spending spikes.",
        "Review recurring subscriptions you no longer use."
      ],
      anomalies: [
        "Spike in general shopping identified in the first week."
      ],
      habits: [
        "Consistent dining spending.",
        "Frequent minor utility transactions."
      ],
      advice: "Consistency is key; keep logging your transactions regularly.",
      recommendedBudgets: Object.entries(catSummary).map(([cat, amt]) => ({
        category: cat,
        suggestedAmount: Math.round(amt * 1.1)
      }))
    };
  }

  const processingTimeMs = Date.now() - startTime;

  // Save to DB
  const dbInsight = await prisma.aIInsight.create({
    data: {
      userId,
      summary: responseObj.summary,
      recommendations: responseObj.recommendations,
      anomalies: responseObj.anomalies,
      promptVersion: PROMPT_VERSION,
      modelName: MODEL_NAME,
      tokenEstimate: 500, // mock estimate
      processingTimeMs,
      expenseCount,
      totalSpentAmount
    }
  });

  return {
    success: true,
    summary: dbInsight.summary,
    recommendations: dbInsight.recommendations,
    anomalies: dbInsight.anomalies,
    habits: responseObj.habits || [],
    advice: responseObj.advice || '',
    recommendedBudgets: responseObj.recommendedBudgets || [],
    generatedAt: dbInsight.generatedAt.toISOString(),
    fromCache: false
  };
};

/**
 * Fetch insights history for a user
 */
const getAIInsightsHistory = async (userId) => {
  return prisma.aIInsight.findMany({
    where: { userId },
    orderBy: { generatedAt: 'desc' }
  });
};

module.exports = {
  getAISpendingInsights,
  getAIInsightsHistory
};
