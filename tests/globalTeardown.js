const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

module.exports = async () => {
  console.log('\n⚙️ Cleaning up test containers...');
  
  const configPath = path.join(__dirname, '.test-containers.json');
  if (fs.existsSync(configPath)) {
    try {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      if (config.postgresId) {
        console.log(`Stopping Postgres container ${config.postgresId.substring(0, 12)}...`);
        execSync(`docker stop ${config.postgresId} && docker rm ${config.postgresId}`, { stdio: 'ignore' });
      }
      if (config.redisId) {
        console.log(`Stopping Redis container ${config.redisId.substring(0, 12)}...`);
        execSync(`docker stop ${config.redisId} && docker rm ${config.redisId}`, { stdio: 'ignore' });
      }
      console.log('✓ Test containers stopped and removed.');
    } catch (e) {
      console.warn('⚠ Error during explicit container teardown:', e.message);
    }
    
    try {
      fs.unlinkSync(configPath);
    } catch (e) {
      // ignore
    }
  }
  console.log('✓ Cleanup completed.\n');
};
