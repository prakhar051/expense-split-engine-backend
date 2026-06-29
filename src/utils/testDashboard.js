const prisma = require('./prisma');

const BASE_URL = 'http://localhost:5000/api';

async function apiRequest(path, method = 'GET', body = null, token = null) {
  const url = `${BASE_URL}${path}`;
  const headers = { 'Content-Type': 'application/json' };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const options = {
    method,
    headers
  };

  if (body) {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(url, options);
  const data = await response.json();

  if (!response.ok) {
    const error = new Error(`Request failed with status ${response.status}`);
    error.status = response.status;
    error.data = data;
    throw error;
  }

  return data;
}

async function runTests() {
  console.log('=== Starting Phase 11: Dashboard Summary & Analytics Engine Verification ===\n');

  const timestamp = Date.now();
  const u1Email = `user1_${timestamp}@example.com`;
  const u2Email = `user2_${timestamp}@example.com`;
  const u3Email = `user3_${timestamp}@example.com`;
  const password = 'Password123';

  let u1Token, u2Token;
  let u1Id, u2Id, u3Id;
  let groupAId, groupBId, groupCId;

  try {
    // 1. Register Users
    console.log('1. Registering test users...');
    const u1Reg = await apiRequest('/auth/register', 'POST', {
      email: u1Email,
      password,
      name: 'Dashboard User'
    });
    u1Id = u1Reg.user.id;
    console.log(`   Registered User 1: ${u1Email} (${u1Id})`);

    const u2Reg = await apiRequest('/auth/register', 'POST', {
      email: u2Email,
      password,
      name: 'Alice'
    });
    u2Id = u2Reg.user.id;
    console.log(`   Registered User 2: ${u2Email} (${u2Id})`);

    const u3Reg = await apiRequest('/auth/register', 'POST', {
      email: u3Email,
      password,
      name: 'Bob'
    });
    u3Id = u3Reg.user.id;
    console.log(`   Registered User 3: ${u3Email} (${u3Id})`);

    // 2. Login Users
    console.log('\n2. Logging in users to retrieve tokens...');
    const u1Login = await apiRequest('/auth/login', 'POST', {
      email: u1Email,
      password
    });
    u1Token = u1Login.accessToken;

    const u2Login = await apiRequest('/auth/login', 'POST', {
      email: u2Email,
      password
    });
    u2Token = u2Login.accessToken;

    // 3. Create Groups and Add Members
    console.log('\n3. Creating 3 groups and setting up memberships...');
    // Group A (User 1 & User 2)
    const grpARes = await apiRequest('/groups', 'POST', { name: 'Group A', description: 'Group A Desc' }, u1Token);
    groupAId = grpARes.group.id;
    // Invite User 2 to Group A
    const inviteARes = await apiRequest(`/groups/${groupAId}/invite`, 'POST', { email: u2Email, expiresInHours: 1 }, u1Token);
    await apiRequest('/groups/join', 'POST', { inviteCode: inviteARes.invite.code }, u2Token);
    console.log(`   Group A setup complete: ID = ${groupAId}`);

    // Group B (User 1 & User 2)
    const grpBRes = await apiRequest('/groups', 'POST', { name: 'Group B', description: 'Group B Desc' }, u1Token);
    groupBId = grpBRes.group.id;
    // Invite User 2 to Group B
    const inviteBRes = await apiRequest(`/groups/${groupBId}/invite`, 'POST', { email: u2Email, expiresInHours: 1 }, u1Token);
    await apiRequest('/groups/join', 'POST', { inviteCode: inviteBRes.invite.code }, u2Token);
    console.log(`   Group B setup complete: ID = ${groupBId}`);

    // Group C (User 1, User 2, User 3)
    const grpCRes = await apiRequest('/groups', 'POST', { name: 'Group C', description: 'Group C Desc' }, u1Token);
    groupCId = grpCRes.group.id;
    // Invite User 2 and User 3 to Group C
    const inviteC2Res = await apiRequest(`/groups/${groupCId}/invite`, 'POST', { email: u2Email, expiresInHours: 1 }, u1Token);
    await apiRequest('/groups/join', 'POST', { inviteCode: inviteC2Res.invite.code }, u2Token);
    // User 3 needs a login token to join
    const u3Login = await apiRequest('/auth/login', 'POST', { email: u3Email, password });
    const inviteC3Res = await apiRequest(`/groups/${groupCId}/invite`, 'POST', { email: u3Email, expiresInHours: 1 }, u1Token);
    await apiRequest('/groups/join', 'POST', { inviteCode: inviteC3Res.invite.code }, u3Login.accessToken);
    console.log(`   Group C setup complete: ID = ${groupCId}`);

    // 4. Create Expenses
    console.log('\n4. Creating expenses in different groups and categories...');
    
    // Expense 1 (Group A): FOOD, amount 3000, paid by User 1, split equally (User 1 & User 2)
    // User 1 share = 1500, User 2 share = 1500. User 1 net balance in Group A = +1500
    const exp1Res = await apiRequest('/expenses', 'POST', {
      groupId: groupAId,
      title: 'Food expense',
      amount: 3000,
      category: 'FOOD',
      splitType: 'EQUAL',
      paidById: u1Id,
      participants: [{ userId: u1Id }, { userId: u2Id }]
    }, u1Token);
    console.log(`   Created Expense 1: ${exp1Res.expense.id}`);

    // Expense 2 (Group B): RENT, amount 6000, paid by User 2, split equally (User 1 & User 2)
    // User 1 share = 3000, User 2 share = 3000. User 1 net balance in Group B = -3000
    const exp2Res = await apiRequest('/expenses', 'POST', {
      groupId: groupBId,
      title: 'Rent expense',
      amount: 6000,
      category: 'RENT',
      splitType: 'EQUAL',
      paidById: u2Id,
      participants: [{ userId: u1Id }, { userId: u2Id }]
    }, u2Token);
    console.log(`   Created Expense 2: ${exp2Res.expense.id}`);

    // Expense 3 (Group C): TRAVEL, amount 10000, paid by User 1, exact split: User 1: 4000, User 2: 3000, User 3: 3000
    // User 1 share = 4000. User 1 net balance in Group C = +6000
    const exp3Res = await apiRequest('/expenses', 'POST', {
      groupId: groupCId,
      title: 'Travel expense',
      amount: 10000,
      category: 'TRAVEL',
      splitType: 'EXACT',
      paidById: u1Id,
      participants: [
        { userId: u1Id, amount: 4000 },
        { userId: u2Id, amount: 3000 },
        { userId: u3Id, amount: 3000 }
      ]
    }, u1Token);
    console.log(`   Created Expense 3: ${exp3Res.expense.id}`);

    // Expense 4 (Group C): FOOD, amount 5000, paid by User 2, exact split: User 1: 2500, User 2: 2500
    const exp4Res = await apiRequest('/expenses', 'POST', {
      groupId: groupCId,
      title: 'Pizza night',
      amount: 5000,
      category: 'FOOD',
      splitType: 'EXACT',
      paidById: u2Id,
      participants: [
        { userId: u1Id, amount: 2500 },
        { userId: u2Id, amount: 2500 }
      ]
    }, u2Token);
    console.log(`   Created Expense 4: ${exp4Res.expense.id}`);

    // Expense 5 (Group A): UTILITIES, amount 2000, paid by User 2, exact split: User 1: 1000, User 2: 1000
    const exp5Res = await apiRequest('/expenses', 'POST', {
      groupId: groupAId,
      title: 'Electricity bill',
      amount: 2000,
      category: 'UTILITIES',
      splitType: 'EXACT',
      paidById: u2Id,
      participants: [
        { userId: u1Id, amount: 1000 },
        { userId: u2Id, amount: 1000 }
      ]
    }, u2Token);
    console.log(`   Created Expense 5: ${exp5Res.expense.id}`);

    // 5. Update Expense Dates directly in DB to test Monthly Trends
    console.log('\n5. Updating expense creation dates in DB to simulate monthly trends...');
    const today = new Date();

    // Expense 1 -> Current Month (June 2026) -> no change needed
    // Expense 2 -> 1 Month Ago (May 2026)
    const date1MonthAgo = new Date(today.getFullYear(), today.getMonth() - 1, 15);
    await prisma.expense.update({
      where: { id: exp2Res.expense.id },
      data: { createdAt: date1MonthAgo }
    });

    // Expense 3 -> 2 Months Ago (April 2026)
    const date2MonthsAgo = new Date(today.getFullYear(), today.getMonth() - 2, 15);
    await prisma.expense.update({
      where: { id: exp3Res.expense.id },
      data: { createdAt: date2MonthsAgo }
    });

    // Expense 4 -> 5 Months Ago (January 2026)
    const date5MonthsAgo = new Date(today.getFullYear(), today.getMonth() - 5, 15);
    await prisma.expense.update({
      where: { id: exp4Res.expense.id },
      data: { createdAt: date5MonthsAgo }
    });

    // Expense 5 -> 6 Months Ago (December 2025) - Should be excluded from last 6 months trends
    const date6MonthsAgo = new Date(today.getFullYear(), today.getMonth() - 6, 15);
    await prisma.expense.update({
      where: { id: exp5Res.expense.id },
      data: { createdAt: date6MonthsAgo }
    });

    console.log('   ✓ Dates updated successfully!');

    // 6. Test GET /api/dashboard/summary
    console.log('\n6. Requesting GET /api/dashboard/summary...');
    const summaryRes = await apiRequest('/dashboard/summary', 'GET', null, u1Token);
    console.log('   Response status: 200 OK');
    console.log('   Response body:', JSON.stringify(summaryRes, null, 2));

    // Verify summary values
    // Group A balance for User 1:
    // paid = 3000 (Exp 1), owed = 1500 (Exp 1) + 1000 (Exp 5) = 2500
    // net = 3000 - 2500 = +500 cents (User 1 is owed)
    // Group B balance for User 1:
    // paid = 0, owed = 3000 (Exp 2) = 3000
    // net = 0 - 3000 = -3000 cents (User 1 owes)
    // Group C balance for User 1:
    // paid = 10000 (Exp 3), owed = 4000 (Exp 3) + 2500 (Exp 4) = 6500
    // net = 10000 - 6500 = +3500 cents (User 1 is owed)
    //
    // Sum of positive balances = 500 + 3500 = 4000 cents (totalOwedToYou)
    // Sum of negative balances = 3000 cents (totalYouOwe)
    // totalNetBalance = 4000 - 3000 = 1000 cents
    // groups = 3
    if (!summaryRes.success) throw new Error('Expected success: true');
    const { totalNetBalance, totalOwedToYou, totalYouOwe, groups } = summaryRes.summary;
    console.log(`   Asserting: totalNetBalance = 1000, got ${totalNetBalance}`);
    console.log(`   Asserting: totalOwedToYou = 4000, got ${totalOwedToYou}`);
    console.log(`   Asserting: totalYouOwe = 3000, got ${totalYouOwe}`);
    console.log(`   Asserting: groups = 3, got ${groups}`);

    if (totalNetBalance !== 1000) throw new Error(`Incorrect totalNetBalance: ${totalNetBalance}`);
    if (totalOwedToYou !== 4000) throw new Error(`Incorrect totalOwedToYou: ${totalOwedToYou}`);
    if (totalYouOwe !== 3000) throw new Error(`Incorrect totalYouOwe: ${totalYouOwe}`);
    if (groups !== 3) throw new Error(`Incorrect groups: ${groups}`);
    console.log('   ✓ Dashboard Summary validation passed!');

    // 7. Test GET /api/dashboard/analytics
    console.log('\n7. Requesting GET /api/dashboard/analytics...');
    const analyticsRes = await apiRequest('/dashboard/analytics', 'GET', null, u1Token);
    console.log('   Response status: 200 OK');
    console.log('   Response body:', JSON.stringify(analyticsRes, null, 2));

    if (!analyticsRes.success) throw new Error('Expected success: true');
    const { categoryBreakdown, monthlyTrends } = analyticsRes.analytics;

    // Verify Category Breakdown
    // TRAVEL: 4000 cents (Exp 3)
    // FOOD: 1500 (Exp 1) + 2500 (Exp 4) = 4000 cents
    // RENT: 3000 cents (Exp 2)
    // UTILITIES: 1000 cents (Exp 5)
    // Sorted by spent descending: TRAVEL (4000), FOOD (4000), RENT (3000), UTILITIES (1000)
    console.log('\n   Validating Category Breakdown:');
    categoryBreakdown.forEach((c, idx) => {
      console.log(`     #${idx + 1}: Category = ${c.category}, Spent = ${c.spent}`);
    });

    const categoriesExpected = ['TRAVEL', 'FOOD', 'RENT', 'UTILITIES'];
    categoriesExpected.forEach((cat) => {
      const match = categoryBreakdown.find(c => c.category === cat);
      if (!match) throw new Error(`Missing category ${cat} in breakdown`);
    });

    if (categoryBreakdown[0].spent !== 4000) throw new Error('First category should have 4000 spent');
    if (categoryBreakdown[1].spent !== 4000) throw new Error('Second category should have 4000 spent');
    if (categoryBreakdown[2].spent !== 3000) throw new Error('Third category should have 3000 spent');
    if (categoryBreakdown[3].spent !== 1000) throw new Error('Fourth category should have 1000 spent');

    console.log('   ✓ Category Breakdown validation passed!');

    // Verify Monthly Trends
    // Excludes December 2025 (Exp 5 - UTILITIES: 1000).
    // June 2026 (current month) -> Exp 1 -> FOOD 1500
    // May 2026 (1 Month Ago) -> Exp 2 -> RENT 3000
    // April 2026 (2 Months Ago) -> Exp 3 -> TRAVEL 4000
    // March 2026 (3 Months Ago) -> 0
    // February 2026 (4 Months Ago) -> 0
    // January 2026 (5 Months Ago) -> Exp 4 -> FOOD 2500
    console.log('\n   Validating Monthly Trends (last 6 months):');
    if (monthlyTrends.length !== 6) throw new Error(`Expected exactly 6 months, got ${monthlyTrends.length}`);

    monthlyTrends.forEach((m, idx) => {
      console.log(`     Month #${idx + 1}: ${m.month}, Spent: ${m.spent}, PersonalSpent: ${m.personalSpent}`);
    });

    const monthNames = [
      "January", "February", "March", "April", "May", "June",
      "July", "August", "September", "October", "November", "December"
    ];

    for (let i = 5; i >= 0; i--) {
      const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
      const expectedMonthName = monthNames[d.getMonth()];
      const actualTrend = monthlyTrends[5 - i];

      if (actualTrend.month !== expectedMonthName) {
        throw new Error(`Expected month at index ${5 - i} to be ${expectedMonthName}, got ${actualTrend.month}`);
      }

      // Check values
      if (i === 5) { // 5 Months Ago (January) -> 2500
        if (actualTrend.spent !== 2500) throw new Error(`Expected 2500 spent 5 months ago, got ${actualTrend.spent}`);
      } else if (i === 4) { // 4 Months Ago (February) -> 0
        if (actualTrend.spent !== 0) throw new Error(`Expected 0 spent 4 months ago, got ${actualTrend.spent}`);
      } else if (i === 3) { // 3 Months Ago (March) -> 0
        if (actualTrend.spent !== 0) throw new Error(`Expected 0 spent 3 months ago, got ${actualTrend.spent}`);
      } else if (i === 2) { // 2 Months Ago (April) -> 4000
        if (actualTrend.spent !== 4000) throw new Error(`Expected 4000 spent 2 months ago, got ${actualTrend.spent}`);
      } else if (i === 1) { // 1 Month Ago (May) -> 3000
        if (actualTrend.spent !== 3000) throw new Error(`Expected 3000 spent 1 month ago, got ${actualTrend.spent}`);
      } else if (i === 0) { // Current Month (June) -> 1500
        if (actualTrend.spent !== 1500) throw new Error(`Expected 1500 spent current month, got ${actualTrend.spent}`);
      }
    }

    console.log('   ✓ Monthly Trends validation passed!');
    console.log('\n=== ALL PHASE 11 VERIFICATION SCENARIOS PASSED SUCCESSFULLY! ===');

  } catch (error) {
    console.error('\n❌ Verification Failed!');
    if (error.data) {
      console.error('Error details:', JSON.stringify(error.data, null, 2));
    } else {
      console.error(error);
    }
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

runTests();
