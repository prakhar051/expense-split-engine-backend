const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function isDockerAvailable() {
  try {
    execSync('docker info', { stdio: 'ignore' });
    return true;
  } catch (e) {
    return false;
  }
}

module.exports = async () => {
  console.log('\n⚙️ Setting up test database and containers...');
  
  let dbUrl;
  let redisUrl;
  let postgresContainer;
  let redisContainer;

  if (isDockerAvailable()) {
    console.log('✓ Docker detected. Starting test containers...');
    try {
      const { GenericContainer } = require('testcontainers');
      
      postgresContainer = await new GenericContainer("postgres:15-alpine")
        .withEnvironment({
          POSTGRES_USER: "postgres",
          POSTGRES_PASSWORD: "testpassword",
          POSTGRES_DB: "greynext_test"
        })
        .withExposedPorts(5432)
        .start();

      const pgPort = postgresContainer.getMappedPort(5432);
      dbUrl = `postgresql://postgres:testpassword@localhost:${pgPort}/greynext_test?schema=public`;

      redisContainer = await new GenericContainer("redis:7-alpine")
        .withExposedPorts(6379)
        .start();

      const redisPort = redisContainer.getMappedPort(6379);
      redisUrl = `redis://localhost:${redisPort}`;

      // Store IDs in temporary config file to share with teardown
      fs.writeFileSync(
        path.join(__dirname, '.test-containers.json'),
        JSON.stringify({
          postgresId: postgresContainer.getId(),
          redisId: redisContainer.getId(),
          dbUrl,
          redisUrl
        })
      );
    } catch (err) {
      console.warn('⚠ Error booting Docker test containers. Falling back to local test config.', err.message);
    }
  }

  // Fallback to local configuration if docker is not running or failed
  if (!dbUrl) {
    console.log('⚠ Docker not available/failed. Using local test databases configurations...');
    dbUrl = process.env.TEST_DATABASE_URL || "postgresql://postgres:Prakhar%23555@localhost:5432/splitsdb_test?schema=public";
    redisUrl = process.env.TEST_REDIS_URL || "redis://localhost:6379";
  }

  // Export config to process environment
  process.env.DATABASE_URL = dbUrl;
  process.env.REDIS_URL = redisUrl;
  process.env.JWT_SECRET = "test_access_token_secret_longer_than_ten_chars_for_validation";
  process.env.REFRESH_TOKEN_SECRET = "test_refresh_token_secret_longer_than_ten_chars_for_validation";
  process.env.GEMINI_API_KEY = "test_gemini_key";
  process.env.CLOUDINARY_CLOUD_NAME = "test_cloudinary_cloud";
  process.env.CLOUDINARY_API_KEY = "123456789012345";
  process.env.CLOUDINARY_API_SECRET = "test_cloudinary_api_secret_12345";
  process.env.NODE_ENV = "test";
  process.env.BASE_CURRENCY = "INR";
  process.env.APP_VERSION = "1.0.0";
  process.env.SERVER_PORT = "5099";

  console.log(`DATABASE_URL: ${process.env.DATABASE_URL}`);
  console.log(`REDIS_URL: ${process.env.REDIS_URL}`);

  // Run migrations/db push on test database
  console.log('Running Prisma schema sync on test database...');
  try {
    execSync('npx prisma db push --accept-data-loss', {
      cwd: path.resolve(__dirname, '..'),
      env: process.env,
      stdio: 'inherit'
    });
    console.log('✓ Test database schema successfully pushed!');
  } catch (err) {
    console.error('❌ Failed to push schema to test database:', err.message);
    throw err;
  }
};
