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
  const data = await response.json();

  if (!response.ok) {
    const error = new Error(data.message || `Request failed with status ${response.status}`);
    error.status = response.status;
    error.data = data;
    throw error;
  }

  return data;
}

async function run() {
  console.log('================================================================');
  console.log('PHASE 19 INTEGRATION VERIFICATION RUN');
  console.log('================================================================\n');

  const timestamp = Date.now();
  let tokenA, tokenB, tokenC;
  let userA, userB, userC;
  let groupId, expenseId;

  // 1. Setup Users
  try {
    console.log('--- Step 1: Setting up test users A, B and C ---');
    
    // Register User A
    const resA = await apiRequest('/auth/register', 'POST', {
      email: `userA_${timestamp}@example.com`,
      password: 'Password123',
      name: 'User A (Owner)'
    });
    userA = resA.user;
    const loginA = await apiRequest('/auth/login', 'POST', {
      email: `userA_${timestamp}@example.com`,
      password: 'Password123'
    });
    tokenA = loginA.accessToken;

    // Register User B
    const resB = await apiRequest('/auth/register', 'POST', {
      email: `userB_${timestamp}@example.com`,
      password: 'Password123',
      name: 'User B (Member)'
    });
    userB = resB.user;
    const loginB = await apiRequest('/auth/login', 'POST', {
      email: `userB_${timestamp}@example.com`,
      password: 'Password123'
    });
    tokenB = loginB.accessToken;

    // Register User C
    const resC = await apiRequest('/auth/register', 'POST', {
      email: `userC_${timestamp}@example.com`,
      password: 'Password123',
      name: 'User C (Non-member)'
    });
    userC = resC.user;
    const loginC = await apiRequest('/auth/login', 'POST', {
      email: `userC_${timestamp}@example.com`,
      password: 'Password123'
    });
    tokenC = loginC.accessToken;

    console.log(`   Users created. User A: ${userA.id}, User B: ${userB.id}, User C: ${userC.id}`);
    console.log('Result: PASS\n');
  } catch (err) {
    console.error('Setup failed:', err);
    process.exit(1);
  }

  // 2. Setup Group and Members
  try {
    console.log('--- Step 2: User A creates a group and adds User B ---');
    const groupRes = await apiRequest('/groups', 'POST', {
      name: `Phase 19 Test Group ${timestamp}`,
      description: 'Integration test group'
    }, tokenA);
    groupId = groupRes.group.id;
    console.log(`   Group created. ID: ${groupId}`);

    // Add User B
    await apiRequest(`/groups/${groupId}/members`, 'POST', {
      userId: userB.id
    }, tokenA);
    console.log('   User B added as member.');
    console.log('Result: PASS\n');
  } catch (err) {
    console.error('Group setup failed:', err);
    process.exit(1);
  }

  // 3. Create initial expense (EQUAL split)
  try {
    console.log('--- Step 3: Create initial EQUAL split expense ---');
    const expRes = await apiRequest('/expenses', 'POST', {
      title: 'Initial Expense',
      category: 'FOOD',
      amount: 3000, // $30.00
      groupId,
      paidById: userA.id,
      splitType: 'EQUAL',
      participants: [
        { userId: userA.id },
        { userId: userB.id }
      ]
    }, tokenA);
    expenseId = expRes.expense.id;
    console.log(`   Expense created. ID: ${expenseId}`);

    // Add a mock attachment directly via database to test preservation
    await prisma.expenseAttachment.create({
      data: {
        expenseId,
        fileUrl: 'http://cloudinary.com/test.jpg',
        publicId: 'test_public_id',
        uploadedById: userA.id
      }
    });
    console.log('   Mock attachment created in DB.');
    console.log('Result: PASS\n');
  } catch (err) {
    console.error('Initial expense failed:', err);
    process.exit(1);
  }

  // 4. Edit expense - EQUAL
  try {
    console.log('--- Step 4: Edit Equal split ---');
    const updateRes = await apiRequest(`/expenses/${expenseId}`, 'PUT', {
      title: 'Edited Equal Expense',
      category: 'GENERAL',
      amount: 4000, // $40.00
      groupId,
      paidById: userA.id,
      splitType: 'EQUAL',
      participants: [
        { userId: userA.id },
        { userId: userB.id }
      ]
    }, tokenA);

    const expense = updateRes.expense;
    if (expense.amount !== 4000 || expense.title !== 'Edited Equal Expense') {
      throw new Error('EQUAL split values mismatch after edit');
    }
    const partA = expense.participants.find(p => p.userId === userA.id);
    const partB = expense.participants.find(p => p.userId === userB.id);
    if (partA.shareAmount !== 2000 || partB.shareAmount !== 2000) {
      throw new Error(`Expected Equal split share amount 2000, got: A=${partA.shareAmount}, B=${partB.shareAmount}`);
    }
    console.log('Result: PASS\n');
  } catch (err) {
    console.error('Edit Equal failed:', err);
    process.exit(1);
  }

  // 5. Edit expense - EXACT
  try {
    console.log('--- Step 5: Edit Exact split ---');
    const updateRes = await apiRequest(`/expenses/${expenseId}`, 'PUT', {
      title: 'Edited Exact Expense',
      category: 'GENERAL',
      amount: 4000,
      groupId,
      paidById: userA.id,
      splitType: 'EXACT',
      participants: [
        { userId: userA.id, amount: 2500 },
        { userId: userB.id, amount: 1500 }
      ]
    }, tokenA);

    const expense = updateRes.expense;
    const partA = expense.participants.find(p => p.userId === userA.id);
    const partB = expense.participants.find(p => p.userId === userB.id);
    if (partA.shareAmount !== 2500 || partB.shareAmount !== 1500) {
      throw new Error(`Expected Exact shares 2500 & 1500, got: A=${partA.shareAmount}, B=${partB.shareAmount}`);
    }
    console.log('Result: PASS\n');
  } catch (err) {
    console.error('Edit Exact failed:', err);
    process.exit(1);
  }

  // 6. Edit expense - PERCENTAGE
  try {
    console.log('--- Step 6: Edit Percentage split ---');
    const updateRes = await apiRequest(`/expenses/${expenseId}`, 'PUT', {
      title: 'Edited Percentage Expense',
      category: 'GENERAL',
      amount: 5000,
      groupId,
      paidById: userA.id,
      splitType: 'PERCENTAGE',
      participants: [
        { userId: userA.id, percentage: 60 },
        { userId: userB.id, percentage: 40 }
      ]
    }, tokenA);

    const expense = updateRes.expense;
    const partA = expense.participants.find(p => p.userId === userA.id);
    const partB = expense.participants.find(p => p.userId === userB.id);
    if (partA.shareAmount !== 3000 || partB.shareAmount !== 2000) {
      throw new Error(`Expected Percentage shares 3000 & 2000, got: A=${partA.shareAmount}, B=${partB.shareAmount}`);
    }
    console.log('Result: PASS\n');
  } catch (err) {
    console.error('Edit Percentage failed:', err);
    process.exit(1);
  }

  // 7. Edit expense - SHARE
  try {
    console.log('--- Step 7: Edit Share split ---');
    const updateRes = await apiRequest(`/expenses/${expenseId}`, 'PUT', {
      title: 'Edited Share Expense',
      category: 'GENERAL',
      amount: 6000,
      groupId,
      paidById: userA.id,
      splitType: 'SHARE',
      participants: [
        { userId: userA.id, shares: 2 },
        { userId: userB.id, shares: 1 }
      ]
    }, tokenA);

    const expense = updateRes.expense;
    const partA = expense.participants.find(p => p.userId === userA.id);
    const partB = expense.participants.find(p => p.userId === userB.id);
    if (partA.shareAmount !== 4000 || partB.shareAmount !== 2000) {
      throw new Error(`Expected Share ratio shares 4000 & 2000, got: A=${partA.shareAmount}, B=${partB.shareAmount}`);
    }
    console.log('Result: PASS\n');
  } catch (err) {
    console.error('Edit Share failed:', err);
    process.exit(1);
  }

  // 8. Edit expense - MULTI_PAYER
  try {
    console.log('--- Step 8: Edit Multi-payer split ---');
    const updateRes = await apiRequest(`/expenses/${expenseId}`, 'PUT', {
      title: 'Edited Multi-Payer Expense',
      category: 'GENERAL',
      amount: 6000,
      groupId,
      splitType: 'MULTI_PAYER',
      payers: [
        { userId: userA.id, amount: 4000 },
        { userId: userB.id, amount: 2000 }
      ],
      participants: [
        { userId: userA.id },
        { userId: userB.id }
      ]
    }, tokenA);

    const expense = updateRes.expense;
    if (expense.payers.length !== 2) {
      throw new Error('Expected 2 payers in edited multi-payer expense');
    }
    const payerA = expense.payers.find(p => p.userId === userA.id);
    const payerB = expense.payers.find(p => p.userId === userB.id);
    if (payerA.amount !== 4000 || payerB.amount !== 2000) {
      throw new Error(`Expected Multi-payer contributions 4000 & 2000, got: A=${payerA.amount}, B=${payerB.amount}`);
    }
    console.log('Result: PASS\n');
  } catch (err) {
    console.error('Edit Multi-Payer failed:', err);
    process.exit(1);
  }

  // 9. Unauthorized edit returns 403
  try {
    console.log('--- Step 9: Verify Unauthorized Edit Rejection ---');
    try {
      await apiRequest(`/expenses/${expenseId}`, 'PUT', {
        title: 'Unauthorized Attempt',
        category: 'GENERAL',
        amount: 6000,
        groupId,
        paidById: userB.id,
        splitType: 'EQUAL',
        participants: [
          { userId: userA.id },
          { userId: userB.id }
        ]
      }, tokenB); // User B is not creator or owner, should fail!
      throw new Error('Server accepted unauthorized edit by non-creator user!');
    } catch (err) {
      if (err.status !== 403) throw err;
      console.log('   User B edit attempt rejected with 403 (Expected)');
    }

    try {
      await apiRequest(`/expenses/${expenseId}`, 'PUT', {
        title: 'External Attempt',
        category: 'GENERAL',
        amount: 6000,
        groupId,
        paidById: userC.id,
        splitType: 'EQUAL',
        participants: [
          { userId: userC.id }
        ]
      }, tokenC); // User C is external, should fail!
      throw new Error('Server accepted unauthorized edit by external user!');
    } catch (err) {
      if (err.status !== 403) throw err;
      console.log('   External User C edit attempt rejected with 403 (Expected)');
    }
    console.log('Result: PASS\n');
  } catch (err) {
    console.error('Unauthorized Edit verification failed:', err);
    process.exit(1);
  }

  // 10. Attachments remain intact
  try {
    console.log('--- Step 10: Verify attachments remain intact after editing ---');
    const attachments = await prisma.expenseAttachment.findMany({
      where: { expenseId }
    });
    if (attachments.length !== 1 || attachments[0].publicId !== 'test_public_id') {
      throw new Error(`Expected exactly 1 attachment with publicId test_public_id, got: ${JSON.stringify(attachments)}`);
    }
    console.log('   Attachments intact.');
    console.log('Result: PASS\n');
  } catch (err) {
    console.error('Attachment integrity check failed:', err);
    process.exit(1);
  }

  // 11. Balances and Dashboard update correctly
  try {
    console.log('--- Step 11: Verify balance recalculations ---');
    const balanceRes = await apiRequest(`/groups/${groupId}/balances`, 'GET', null, tokenA);
    console.log('   Balances response:', JSON.stringify(balanceRes));
    
    // In step 8 multi-payer edit:
    // Amount = 6000
    // Payers: A=4000, B=2000
    // Split equally: A owes 3000, B owes 3000
    // Net: A paid 4000, owes 3000 -> Net = +1000
    // Net: B paid 2000, owes 3000 -> Net = -1000
        const netA = balanceRes.balances.find(b => b.user.id === userA.id)?.netBalance;
    const netB = balanceRes.balances.find(b => b.user.id === userB.id)?.netBalance;
    if (netA !== 1000 || netB !== -1000) {
      throw new Error(`Expected balances: A=+1000, B=-1000. Got: A=${netA}, B=${netB}`);
    }
    console.log('Result: PASS\n');
  } catch (err) {
    console.error('Balance verification failed:', err);
    process.exit(1);
  }

  // 12. Non-owner removal rejected
  try {
    console.log('--- Step 12: Verify Non-owner Member Removal Rejection ---');
    try {
      await apiRequest(`/groups/${groupId}/members/${userA.id}`, 'DELETE', null, tokenB); // User B tries to remove User A
      throw new Error('Server allowed non-owner member removal!');
    } catch (err) {
      if (err.status !== 403) throw err;
      console.log('   Non-owner removal rejected with 403 (Expected)');
    }
    console.log('Result: PASS\n');
  } catch (err) {
    console.error('Member removal rejection check failed:', err);
    process.exit(1);
  }

  // 13. Owner cannot remove themselves or leave before transfer
  try {
    console.log('--- Step 13: Verify Owner cannot remove self or leave ---');
    try {
      await apiRequest(`/groups/${groupId}/members/${userA.id}`, 'DELETE', null, tokenA); // Owner A tries to remove Owner A
      throw new Error('Server allowed Owner to remove themselves!');
    } catch (err) {
      if (err.status !== 400) throw err;
      console.log('   Owner self-removal rejected with 400 (Expected)');
    }

    try {
      await apiRequest(`/groups/${groupId}/leave`, 'POST', null, tokenA); // Owner A tries to leave
      throw new Error('Server allowed Owner to leave without ownership transfer!');
    } catch (err) {
      if (err.status !== 400) throw err;
      console.log('   Owner leave attempt rejected with 400 (Expected)');
    }
    console.log('Result: PASS\n');
  } catch (err) {
    console.error('Owner restrictions check failed:', err);
    process.exit(1);
  }

  // 14. Transfer to non-member and self rejected
  try {
    console.log('--- Step 14: Verify Transfer validations ---');
    try {
      await apiRequest(`/groups/${groupId}/transfer-ownership`, 'POST', { newOwnerId: userC.id }, tokenA); // User C not in group
      throw new Error('Server allowed transfer to a non-member!');
    } catch (err) {
      if (err.status !== 400) throw err;
      console.log('   Transfer to non-member rejected with 400 (Expected)');
    }

    try {
      await apiRequest(`/groups/${groupId}/transfer-ownership`, 'POST', { newOwnerId: userA.id }, tokenA); // Self
      throw new Error('Server allowed transfer to self!');
    } catch (err) {
      if (err.status !== 400) throw err;
      console.log('   Transfer to self rejected with 400 (Expected)');
    }
    console.log('Result: PASS\n');
  } catch (err) {
    console.error('Transfer validations check failed:', err);
    process.exit(1);
  }

  // 15. Ownership transfer success
  try {
    console.log('--- Step 15: Verify successful Ownership Transfer ---');
    await apiRequest(`/groups/${groupId}/transfer-ownership`, 'POST', { newOwnerId: userB.id }, tokenA);
    console.log('   Transfer API succeeded.');

    const group = await prisma.group.findUnique({
      where: { id: groupId },
      include: { members: true }
    });

    if (group.createdById !== userB.id) {
      throw new Error(`Expected owner ID to be User B (${userB.id}), got: ${group.createdById}`);
    }

    const memberA = group.members.find(m => m.userId === userA.id);
    const memberB = group.members.find(m => m.userId === userB.id);
    if (memberA.role !== 'MEMBER' || memberB.role !== 'OWNER') {
      throw new Error(`Expected role mapping: A=MEMBER, B=OWNER. Got: A=${memberA.role}, B=${memberB.role}`);
    }
    console.log('Result: PASS\n');
  } catch (err) {
    console.error('Ownership transfer failed:', err);
    process.exit(1);
  }

  // 16. Member leaves group
  try {
    console.log('--- Step 16: Verify member leaves group ---');
    // Now User A is a regular member and User B is the Owner
    await apiRequest(`/groups/${groupId}/leave`, 'POST', null, tokenA); // User A leaves
    console.log('   User A left successfully.');

    const group = await prisma.group.findUnique({
      where: { id: groupId },
      include: { members: true }
    });
    const hasA = group.members.some(m => m.userId === userA.id);
    if (hasA) {
      throw new Error('User A is still in group members list after leaving!');
    }
    console.log('Result: PASS\n');
  } catch (err) {
    console.error('Leave group failed:', err);
    process.exit(1);
  }

  // 17. Remove member
  try {
    console.log('--- Step 17: Verify member removal by new Owner B ---');
    // Add User C to group first
    await apiRequest(`/groups/${groupId}/members`, 'POST', {
      userId: userC.id
    }, tokenB); // User B is the new owner
    console.log('   User C added to group.');

    // User B removes User C
    await apiRequest(`/groups/${groupId}/members/${userC.id}`, 'DELETE', null, tokenB);
    console.log('   User C removed by User B.');

    const group = await prisma.group.findUnique({
      where: { id: groupId },
      include: { members: true }
    });
    const hasC = group.members.some(m => m.userId === userC.id);
    if (hasC) {
      throw new Error('User C is still in group members list after removal!');
    }
    console.log('Result: PASS\n');
  } catch (err) {
    console.error('Remove member failed:', err);
    process.exit(1);
  }

  // 18. Verify Activity Logs and Notifications
  try {
    console.log('--- Step 18: Verify activities & notifications ---');
    const activities = await prisma.activity.findMany({
      where: { groupId }
    });
    console.log(`   Found ${activities.length} activity entries for this group.`);
    
    // Check types created: EXPENSE_CREATED, EXPENSE_UPDATED, OWNERSHIP_TRANSFERRED, MEMBER_LEFT, MEMBER_REMOVED, MEMBER_JOINED
    const types = activities.map(a => a.type);
    console.log('   Activity types logged:', types);
    if (!types.includes('EXPENSE_CREATED') || !types.includes('EXPENSE_UPDATED') || !types.includes('OWNERSHIP_TRANSFERRED') || !types.includes('MEMBER_LEFT') || !types.includes('MEMBER_REMOVED')) {
      throw new Error('Missing expected activity types!');
    }

    const notifications = await prisma.notification.findMany({
      where: {
        userId: { in: [userA.id, userB.id, userC.id] }
      }
    });
    console.log(`   Found ${notifications.length} notifications generated for users.`);
    if (notifications.length === 0) {
      throw new Error('Expected notifications to be generated!');
    }
    console.log('Result: PASS\n');
  } catch (err) {
    console.error('Activity/notification check failed:', err);
    process.exit(1);
  }

  console.log('================================================================');
  console.log('ALL PHASE 19 INTEGRATION CHECKS PASSED SUCCESSFULLY!');
  console.log('================================================================');
}

run();
