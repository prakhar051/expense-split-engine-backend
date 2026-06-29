require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const { URL } = require('url');

// Parse database URL to extract details
function parseDatabaseUrl(dbUrl) {
  try {
    const parsed = new URL(dbUrl);
    return {
      host: parsed.hostname,
      port: parsed.port || '5432',
      user: parsed.username,
      password: decodeURIComponent(parsed.password),
      database: parsed.pathname.replace(/^\//, '')
    };
  } catch (e) {
    throw new Error('Invalid DATABASE_URL configuration.');
  }
}

// Check if a command exists in PATH
function commandExists(cmd) {
  try {
    execSync(process.platform === 'win32' ? `where ${cmd}` : `which ${cmd}`, { stdio: 'ignore' });
    return true;
  } catch (e) {
    return false;
  }
}

async function runBackup() {
  console.log('=========================================');
  console.log('📦 DATABASE BACKUP UTILITY');
  console.log('=========================================');

  if (!commandExists('pg_dump')) {
    console.error('❌ Error: pg_dump utility not found in PATH.');
    console.error('Please make sure PostgreSQL client tools are installed and added to PATH.');
    process.exit(1);
  }

  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error('❌ Error: DATABASE_URL variable is not set in environment.');
    process.exit(1);
  }

  const dbParams = parseDatabaseUrl(dbUrl);
  const backupDir = process.env.BACKUP_DIR || path.join(__dirname, '../../backups');

  // Create directory if not exists
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `backup-${dbParams.database}-${timestamp}.dump`;
  const filepath = path.join(backupDir, filename);

  console.log(`Target database: ${dbParams.database} on ${dbParams.host}:${dbParams.port}`);
  console.log(`Output target:   ${filepath}\n`);

  const args = [
    '-h', dbParams.host,
    '-p', dbParams.port,
    '-U', dbParams.user,
    '-F', 'c',             // Custom binary archive format (compressed, recommended for pg_restore)
    '-b',                  // Include large objects
    '-v',                  // Verbose output
    '-f', filepath,
    dbParams.database
  ];

  const pgDump = spawn('pg_dump', args, {
    env: {
      ...process.env,
      PGPASSWORD: dbParams.password // Avoid password prompt interactive hang
    }
  });

  pgDump.stdout.on('data', (data) => {
    process.stdout.write(data);
  });

  pgDump.stderr.on('data', (data) => {
    process.stderr.write(data);
  });

  pgDump.on('close', (code) => {
    console.log('\n=========================================');
    if (code === 0) {
      console.log(`✓ Backup successfully generated!`);
      console.log(`File: ${filename}`);
      console.log('=========================================');
      process.exit(0);
    } else {
      console.error(`❌ Backup failed with exit code ${code}`);
      console.error('=========================================');
      process.exit(1);
    }
  });
}

if (require.main === module) {
  runBackup();
}

module.exports = { runBackup, parseDatabaseUrl, commandExists };
