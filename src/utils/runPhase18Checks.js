const prisma = require('./prisma');

const BASE_URL = 'http://localhost:5000/api';

async function apiRequest(path, method = 'GET', body = null, token = null) {
  const url = `${BASE_URL}${path}`;
  const headers = { 'Content-Type': 'application/json' };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const options = { method, headers };
  if (body) {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(url, options);
  
  // For binary/text downloads, we may need to read headers and body differently
  const contentType = response.headers.get('content-type') || '';
  const contentDisposition = response.headers.get('content-disposition') || '';

  if (contentType.includes('application/json')) {
    const data = await response.json();
    if (!response.ok) {
      const error = new Error(data.message || `Request failed with status ${response.status}`);
      error.status = response.status;
      error.data = data;
      throw error;
    }
    return { data, status: response.status, contentType, contentDisposition };
  } else {
    if (!response.ok) {
      const text = await response.text();
      const error = new Error(text || `Request failed with status ${response.status}`);
      error.status = response.status;
      throw error;
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    return { data: buffer, status: response.status, contentType, contentDisposition };
  }
}

async function run() {
  console.log('================================================================');
  console.log('PHASE 18 EXPORT & REPORTING INTEGRATION VERIFICATION RUN');
  console.log('================================================================\n');

  const timestamp = Date.now();
  const userAEmail = `exporter_usera_${timestamp}@example.com`;
  const userBEmail = `exporter_userb_${timestamp}@example.com`;
  const password = 'Password123';

  let userA = {};
  let userB = {};
  let group = {};

  // 1. Create and authenticate User A & User B
  try {
    console.log('--- Check 1: Creating Users A and B ---');
    const registerA = await apiRequest('/auth/register', 'POST', {
      email: userAEmail,
      password,
      name: 'Alpha Exporter'
    });
    userA.id = registerA.data.user.id;
    userA.token = registerA.data.accessToken;

    const registerB = await apiRequest('/auth/register', 'POST', {
      email: userBEmail,
      password,
      name: 'Beta Observer'
    });
    userB.id = registerB.data.user.id;
    userB.token = registerB.data.accessToken;

    console.log(`   Created User A (ID: ${userA.id}) and User B (ID: ${userB.id})`);
    console.log('Result: PASS\n');
  } catch (err) {
    console.error('Check 1: FAIL', err);
    process.exit(1);
  }

  // 2. User A creates group
  try {
    console.log('--- Check 2: User A Creates Group ---');
    const groupRes = await apiRequest('/groups', 'POST', {
      name: `Export Group Omega ${timestamp}`,
      description: 'Export and Reporting verification group'
    }, userA.token);
    group = groupRes.data.group;
    console.log(`   Group created (ID: ${group.id})`);
    console.log('Result: PASS\n');
  } catch (err) {
    console.error('Check 2: FAIL', err);
    process.exit(1);
  }

  // 3. Test Security & Authorization
  try {
    console.log('--- Check 3: Verify Security & Authorization Filters ---');
    
    // 3a. Unauthenticated request (no token)
    console.log('   Testing unauthenticated request...');
    try {
      await apiRequest(`/groups/${group.id}/export/csv`, 'GET', null, null);
      throw new Error('Accepted unauthenticated request!');
    } catch (err) {
      if (err.status !== 401) throw err;
      console.log('   Rejected unauthenticated request with 401 (Expected)');
    }

    // 3b. Non-member request (User B token)
    console.log('   Testing non-group-member request...');
    try {
      await apiRequest(`/groups/${group.id}/export/csv`, 'GET', null, userB.token);
      throw new Error('Accepted non-group-member request!');
    } catch (err) {
      if (err.status !== 403) throw err;
      console.log('   Rejected non-group-member request with 403 (Expected)');
    }

    console.log('Result: PASS\n');
  } catch (err) {
    console.error('Check 3: FAIL', err);
    process.exit(1);
  }

  // 4. Test Empty State Exports
  try {
    console.log('--- Check 4: Verify Empty State Exports ---');

    // 4a. Empty Expenses CSV
    console.log('   Requesting empty Expenses CSV...');
    const expCSV = await apiRequest(`/groups/${group.id}/export/csv`, 'GET', null, userA.token);
    if (!expCSV.contentType.includes('text/csv')) {
      throw new Error(`Expected text/csv content type, got: ${expCSV.contentType}`);
    }
    if (!expCSV.contentDisposition.includes('attachment')) {
      throw new Error(`Expected attachment disposition, got: ${expCSV.contentDisposition}`);
    }
    const csvLines = expCSV.data.toString().trim().split('\r\n');
    console.log('   CSV header output:', csvLines[0]);
    if (csvLines.length !== 1) {
      throw new Error(`Expected exactly 1 line (headers only), got: ${csvLines.length}`);
    }
    console.log('   Empty CSV exports headers only (PASS)');

    // 4b. Empty Expenses PDF
    console.log('   Requesting empty Expenses PDF...');
    const expPDF = await apiRequest(`/groups/${group.id}/export/pdf`, 'GET', null, userA.token);
    if (!expPDF.contentType.includes('application/pdf')) {
      throw new Error(`Expected application/pdf content type, got: ${expPDF.contentType}`);
    }
    console.log(`   PDF size in bytes: ${expPDF.data.length}`);
    if (expPDF.data.length < 500) {
      throw new Error('PDF data size too small, might be corrupt!');
    }
    console.log('   Empty PDF report generated successfully (PASS)');

    // 4c. Empty Settlements CSV & PDF
    console.log('   Requesting empty Settlements CSV...');
    const setCSV = await apiRequest(`/groups/${group.id}/export/settlements/csv`, 'GET', null, userA.token);
    const setCSVLines = setCSV.data.toString().trim().split('\r\n');
    if (setCSVLines.length !== 1) {
      throw new Error(`Expected exactly 1 line (headers only), got: ${setCSVLines.length}`);
    }
    console.log('   Empty Settlements CSV contains headers only (PASS)');

    console.log('   Requesting empty Settlements PDF...');
    const setPDF = await apiRequest(`/groups/${group.id}/export/settlements/pdf`, 'GET', null, userA.token);
    console.log(`   Settlements PDF size in bytes: ${setPDF.data.length}`);
    console.log('   Empty Settlements PDF report generated successfully (PASS)');

    // 4d. Empty Dashboard PDF
    console.log('   Requesting empty Dashboard PDF...');
    const dashPDF = await apiRequest('/dashboard/export/pdf', 'GET', null, userA.token);
    console.log(`   Dashboard PDF size in bytes: ${dashPDF.data.length}`);
    console.log('   Empty Dashboard PDF report generated successfully (PASS)');

    console.log('Result: PASS\n');
  } catch (err) {
    console.error('Check 4: FAIL', err);
    process.exit(1);
  }

  // 5. Test Single Record Export
  try {
    console.log('--- Check 5: Verify Single Record Export ---');
    // User A creates one expense
    await apiRequest('/expenses', 'POST', {
      title: 'Verifier Lunch',
      amount: 45000, // ₹450.00
      groupId: group.id,
      splitType: 'EQUAL',
      paidById: userA.id,
      participants: [
        { userId: userA.id }
      ]
    }, userA.token);

    // Fetch CSV and verify contains records
    const resCSV = await apiRequest(`/groups/${group.id}/export/csv`, 'GET', null, userA.token);
    const lines = resCSV.data.toString().trim().split('\r\n');
    if (lines.length !== 2) {
      throw new Error(`Expected exactly 2 lines (headers + 1 record), got: ${lines.length}`);
    }
    console.log('   CSV record line:', lines[1]);
    
    // Assert currency formatted (not raw cents)
    if (!lines[1].includes('₹450.00')) {
      throw new Error(`Expected currency amount format "₹450.00" in CSV line, got: "${lines[1]}"`);
    }
    console.log('   Verified currency amount formatted correctly');
    console.log('Result: PASS\n');
  } catch (err) {
    console.error('Check 5: FAIL', err);
    process.exit(1);
  }

  // 6. Test Large Dataset Export & Pagination (120 records)
  try {
    console.log('--- Check 6: Verify Large Dataset Export (120 records) ---');
    console.log('   Seeding database with 120 expenses using Prisma...');

    const expensePromises = [];
    for (let i = 1; i <= 120; i++) {
      expensePromises.push(
        prisma.expense.create({
          data: {
            groupId: group.id,
            title: `Bulk Expense Item #${i}`,
            amount: 1000 * i, // ₹10.00 * i
            splitType: 'EQUAL',
            category: 'FOOD',
            paidById: userA.id,
            payers: {
              create: {
                userId: userA.id,
                amount: 1000 * i
              }
            },
            participants: {
              create: {
                userId: userA.id,
                shareAmount: 1000 * i
              }
            }
          }
        })
      );
    }
    await Promise.all(expensePromises);
    console.log('   Successfully seeded 120 expenses');

    console.log('   Requesting bulk Expenses PDF...');
    const startTime = Date.now();
    const pdfRes = await apiRequest(`/groups/${group.id}/export/pdf`, 'GET', null, userA.token);
    const duration = Date.now() - startTime;
    console.log(`   Piped PDF response size: ${pdfRes.data.length} bytes (Generated in ${duration}ms)`);
    
    if (pdfRes.data.length < 15000) {
      throw new Error('PDF size is too small for a bulk dataset export, page layout/rendering might have failed!');
    }
    console.log('   Bulk PDF generation completed successfully (PASS)');
    console.log('Result: PASS\n');
  } catch (err) {
    console.error('Check 6: FAIL', err);
    process.exit(1);
  }

  // 7. Test Activity Logging
  try {
    console.log('--- Check 7: Verify Export Activity Logging ---');
    
    const activities = await prisma.activity.findMany({
      where: { type: 'REPORT_EXPORTED' },
      orderBy: { createdAt: 'desc' }
    });

    console.log(`   Found ${activities.length} REPORT_EXPORTED activity entries in database`);
    if (activities.length < 5) {
      throw new Error(`Expected at least 5 export activities logged, found: ${activities.length}`);
    }

    // Verify messages
    const sampleMsg = activities[0].message;
    console.log('   Sample activity message:', sampleMsg);
    if (!sampleMsg.includes('exported')) {
      throw new Error('Activity message does not contain "exported" keyword!');
    }

    console.log('Result: PASS\n');
  } catch (err) {
    console.error('Check 7: FAIL', err);
    process.exit(1);
  }

  console.log('================================================================');
  console.log('ALL PHASE 18 EXPORT & REPORTING CHECKS PASSED SUCCESSFULLY!');
  console.log('================================================================');
}

run();
