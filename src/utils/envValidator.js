const { z } = require('zod');

const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  JWT_SECRET: z.string().min(10),
  REFRESH_TOKEN_SECRET: z.string().min(10),
  GEMINI_API_KEY: z.string().min(1),
  CLOUDINARY_CLOUD_NAME: z.string().min(1),
  CLOUDINARY_API_KEY: z.string().min(1),
  CLOUDINARY_API_SECRET: z.string().min(1),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  BASE_CURRENCY: z.string().default('INR'),
  APP_VERSION: z.string().default('1.0.0'),
  SERVER_PORT: z.union([z.string(), z.number()]).transform(val => {
    const parsed = parseInt(String(val), 10);
    return isNaN(parsed) ? 5000 : parsed;
  }).default(5000)
});

let env = {};
try {
  env = envSchema.parse({
    DATABASE_URL: process.env.DATABASE_URL,
    REDIS_URL: process.env.REDIS_URL,
    JWT_SECRET: process.env.JWT_SECRET,
    REFRESH_TOKEN_SECRET: process.env.REFRESH_TOKEN_SECRET,
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
    CLOUDINARY_CLOUD_NAME: process.env.CLOUDINARY_CLOUD_NAME,
    CLOUDINARY_API_KEY: process.env.CLOUDINARY_API_KEY,
    CLOUDINARY_API_SECRET: process.env.CLOUDINARY_API_SECRET,
    NODE_ENV: process.env.NODE_ENV,
    BASE_CURRENCY: process.env.BASE_CURRENCY,
    APP_VERSION: process.env.APP_VERSION,
    SERVER_PORT: process.env.SERVER_PORT || process.env.PORT
  });
} catch (error) {
  console.error('\n=========================================');
  console.error('❌ ENVIRONMENT VALIDATION FAILED!');
  console.error('=========================================');
  const issues = error.errors || error.issues || [];
  if (Array.isArray(issues) && issues.length > 0) {
    issues.forEach((err) => {
      console.error(`Field "${err.path.join('.')}" : ${err.message}`);
    });
  } else {
    console.error(error);
  }
  console.error('=========================================\n');
  process.exit(1);
}

module.exports = env;
