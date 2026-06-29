const { GoogleGenAI } = require('@google/genai');

process.env.GEMINI_API_KEY = 'AIzaSyDummy';

const ai = new GoogleGenAI({});
const ModelsClass = ai.models.constructor;

ModelsClass.prototype.generateContentInternal = async function (model, contents, config) {
  console.log('INTERCEPTED! Model:', model);
  return {
    text: 'mocked success!'
  };
};

async function run() {
  const result = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: 'Hello'
  });
  console.log('Result text:', result.text);
}

run();
