require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { parseDatabaseUrl, commandExists } = require('./dbBackup');

async function runRestore() {
  console.log('=========================================');
  console.log('🔄 DATABASE RESTORE UTILITY');
  console.log('=========================================');

  if (!commandExists('pg_restore')) {
    console.error('❌ Error: pg_restore utility not found in PATH.');
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

  // Determine which file to restore
  let targetFile = process.argv[2]; // Node script argument
  if (!targetFile) {
    // List backups directory and find the latest dump file
    if (!fs.existsSync(backupDir)) {
      console.error(`❌ Error: Backup directory "${backupDir}" does not exist.`);
      process.exit(1);
    }
    
    const files = fs.readdirSync(backupDir)
      .filter(f => f.startsWith('backup-') && f.endsWith('.dump'))
      .map(f => ({ name: f, time: fs.statSync(path.join(backupDir, f)).mtime.getTime() }))
      .sort((a, b) => b.time - a.time);

    if (files.length === 0) {
      console.error(`❌ Error: No backup files found in "${backupDir}".`);
      process.exit(1);
    }

    targetFile = path.join(backupDir, files[0].name);
    console.log(`No restore target specified. Defaulting to latest backup:`);
    console.log(`➔ ${files[0].name}\n`);
  } else {
    // Resolve absolute path if relative path passed
    targetFile = path.resolve(process.cwd(), targetFile);
    if (!fs.existsSync(targetFile)) {
      console.error(`❌ Error: Specified backup file not found: "${targetFile}"`);
      process.exit(1);
    }
    console.log(`Targeting specified backup file:`);
    console.log(`➔ ${path.basename(targetFile)}\n`);
  }

  console.log(`Restoring database: ${dbParams.database} on ${dbParams.host}:${dbParams.port}`);
  console.log(`Source target:      ${targetFile}\n`);

  const args = [
    '-h', dbParams.host,
    '-p', dbParams.port,
    '-U', dbParams.user,
    '-d', dbParams.database,
    '-c',                  // Clean (drop) database objects before recreating
    '--if-exists',         // Use IF EXISTS when dropping objects
    '-v',                  // Verbose output
    targetFile
  ];

  const pgRestore = spawn('pg_restore', args, {
    env: {
      ...process.env,
      PGPASSWORD: dbParams.password // Avoid password prompt interactive hang
    }
  });

  pgRestore.stdout.on('data', (data) => {
    process.stdout.write(data);
  });

  pgRestore.stderr.on('data', (data) => {
    // pg_restore verbose output writes to stderr
    process.stderr.write(data);
  });

  pgRestore.on('close', (code) => {
    console.log('\n=========================================');
    if (code === 0 || code === 1) {
      // Exit code 1 can happen if there are minor warnings (like dropping non-existent tables) which is normal for --clean
      console.log(`✓ Restore successfully completed!`);
      console.log('=========================================');
      process.exit(0);
    } else {
      console.error(`❌ Restore failed with exit code ${code}`);
      console.error('=========================================');
      process.exit(1);
    }
  });
}

if (require.main === module) {
  runRestore();
}

module.exports = { runRestore };
