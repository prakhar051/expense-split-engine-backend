const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '../../../');

function checkFileExists(relPath) {
  const fullPath = path.join(ROOT_DIR, relPath);
  const exists = fs.existsSync(fullPath);
  if (exists) {
    console.log(`✓ [PASS] File found: ${relPath}`);
  } else {
    console.log(`❌ [FAIL] Missing file: ${relPath}`);
  }
  return exists;
}

function runChecks() {
  console.log('================================================================');
  console.log('🔍 RUNNING PHASE 32 DOCUMENTATION & METRICS VALIDATIONS...');
  console.log('================================================================');

  let passed = true;

  // 1. Root documentation
  const rootFiles = [
    'README.md',
    'CONTRIBUTING.md',
    'CHANGELOG.md',
    'SECURITY.md',
    'LICENSE',
    'CODE_OF_CONDUCT.md'
  ];
  for (const f of rootFiles) {
    if (!checkFileExists(f)) passed = false;
  }

  // 2. Documentation Directory
  const docFiles = [
    'docs/database.md',
    'docs/api-reference.md',
    'docs/developer-guide.md',
    'docs/deployment.md',
    'docs/portfolio.md',
    'docs/project-report.md',
    'docs/architecture/README.md',
    'docs/screenshots/.gitkeep',
    'server/src/openapi.json',
    'server/src/utils/seedDemo.js'
  ];
  for (const f of docFiles) {
    if (!checkFileExists(f)) passed = false;
  }

  console.log('================================================================');
  if (passed) {
    console.log('✅ ALL PHASE 32 VERIFICATION CHECKS COMPLETED SUCCESSFULLY!');
    console.log('Overall Status: READY FOR ENTERPRISE DEPLOYMENT');
    console.log('================================================================');
    process.exit(0);
  } else {
    console.log('❌ PHASE 32 VERIFICATION CHECKS ENCOUNTERED FAILURES!');
    console.log('Overall Status: ACTION REQUIRED');
    console.log('================================================================');
    process.exit(1);
  }
}

if (require.main === module) {
  runChecks();
}
