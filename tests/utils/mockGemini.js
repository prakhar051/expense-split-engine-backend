// Mock configuration for Gemini API SDK
const mockGeminiGenerateContent = jest.fn().mockImplementation(async ({ contents }) => {
  const prompt = String(contents || '');
  
  if (prompt.includes('financial advisor') || prompt.includes('analyse') || prompt.includes('monthly financial advice')) {
    // Return AI spending insights payload format
    return {
      text: JSON.stringify({
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
        recommendedBudgets: [
          { category: 'FOOD', suggestedAmount: 11000 }
        ]
      })
    };
  } else {
    // Return receipt categorization payload format
    return {
      text: JSON.stringify({
        merchant: "Starbucks Coffee",
        title: "Coffee Break",
        category: "FOOD",
        confidence: 95,
        reason: "Text contains Starbucks Coffee purchase details."
      })
    };
  }
});

jest.mock('@google/genai', () => {
  return {
    GoogleGenAI: jest.fn().mockImplementation(() => {
      return {
        models: {
          generateContent: mockGeminiGenerateContent
        }
      };
    })
  };
});

module.exports = { mockGeminiGenerateContent };
