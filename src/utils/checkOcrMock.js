const { GoogleGenAI } = require('@google/genai');

// Set a dummy API key so the constructor doesn't complain
process.env.GEMINI_API_KEY = 'AIzaSyDummy';

const ai = new GoogleGenAI({});
console.log('models class:', ai.models.constructor.name);
console.log('generateContent on instance?', Object.hasOwn(ai.models, 'generateContent'));
console.log('generateContent on prototype?', Object.hasOwn(ai.models.constructor.prototype, 'generateContent'));
console.log('type of generateContent:', typeof ai.models.generateContent);

// Print all methods of models instance
console.log('models keys:', Object.getOwnPropertyNames(ai.models));
console.log('models prototype keys:', Object.getOwnPropertyNames(ai.models.constructor.prototype));
