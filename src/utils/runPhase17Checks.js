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

// 1x1 tiny base64 encoded png image
const PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

async function uploadAvatar(base64Str, filename, mimetype, token) {
  const url = `${BASE_URL}/users/profile`;
  const formData = new FormData();
  
  const buffer = Buffer.from(base64Str, 'base64');
  const blob = new Blob([buffer], { type: mimetype });
  formData.append('avatar', blob, filename);

  const response = await fetch(url, {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${token}`
    },
    body: formData
  });

  const data = await response.json();
  if (!response.ok) {
    const error = new Error(data.message || `Avatar upload failed with status ${response.status}`);
    error.status = response.status;
    error.data = data;
    throw error;
  }

  return data;
}

async function uploadProof(settlementId, base64Str, filename, mimetype, token) {
  const url = `${BASE_URL}/settlements/${settlementId}/proof`;
  const formData = new FormData();
  
  const buffer = Buffer.from(base64Str, 'base64');
  const blob = new Blob([buffer], { type: mimetype });
  formData.append('files', blob, filename); // uploadMiddleware expects 'files'

  const response = await fetch(url, {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${token}`
    },
    body: formData
  });

  const data = await response.json();
  if (!response.ok) {
    const error = new Error(data.message || `Proof upload failed with status ${response.status}`);
    error.status = response.status;
    error.data = data;
    throw error;
  }

  return data;
}

async function run() {
  console.log('================================================================');
  console.log('PHASE 17 INTEGRATION & AUDIT LOG VERIFICATION RUN');
  console.log('================================================================\n');

  const timestamp = Date.now();
  const userAEmail = `usera_${timestamp}@example.com`;
  const userBEmail = `userb_${timestamp}@example.com`;
  const password = 'Password123';

  let userA = {};
  let userB = {};
  let group = {};
  let invite = {};
  let expense = {};
  let settlement = {};

  // 1. Create and authenticate User A & User B
  try {
    console.log('--- Check 1: Creating User A and User B ---');
    const registerA = await apiRequest('/auth/register', 'POST', {
      email: userAEmail,
      password,
      name: 'User Alpha'
    });
    userA.id = registerA.user.id;
    userA.token = registerA.accessToken;

    const registerB = await apiRequest('/auth/register', 'POST', {
      email: userBEmail,
      password,
      name: 'User Beta'
    });
    userB.id = registerB.user.id;
    userB.token = registerB.accessToken;

    console.log(`   Created User A (ID: ${userA.id}) and User B (ID: ${userB.id})`);
    console.log('Result: PASS\n');
  } catch (err) {
    console.error('Check 1: FAIL', err);
    process.exit(1);
  }

  // 2. User A creates group (assert GROUP_CREATED activity)
  try {
    console.log('--- Check 2: User A Creates Group ---');
    const groupRes = await apiRequest('/groups', 'POST', {
      name: `Group Omega ${timestamp}`,
      description: 'Audit logging test group'
    }, userA.token);
    group = groupRes.group;
    console.log(`   Group created (ID: ${group.id})`);

    // Verify activity in DB
    const activities = await prisma.activity.findMany({
      where: { groupId: group.id, type: 'GROUP_CREATED' }
    });
    if (activities.length === 0) {
      throw new Error('GROUP_CREATED activity not found in database!');
    }
    console.log('   GROUP_CREATED activity verified in DB:', activities[0].message);
    console.log('Result: PASS\n');
  } catch (err) {
    console.error('Check 2: FAIL', err);
    process.exit(1);
  }

  // 3. User A creates invite (assert INVITE_CREATED activity)
  try {
    console.log('--- Check 3: User A Creates Group Invite ---');
    const inviteRes = await apiRequest(`/groups/${group.id}/invite`, 'POST', {
      expiresInHours: 24
    }, userA.token);
    invite = inviteRes.invite;
    console.log(`   Invite created (Code: ${invite.code})`);

    // Verify activity in DB
    const activities = await prisma.activity.findMany({
      where: { groupId: group.id, type: 'INVITE_CREATED' }
    });
    if (activities.length === 0) {
      throw new Error('INVITE_CREATED activity not found in database!');
    }
    console.log('   INVITE_CREATED activity verified in DB:', activities[0].message);
    console.log('Result: PASS\n');
  } catch (err) {
    console.error('Check 3: FAIL', err);
    process.exit(1);
  }

  // 4. User B joins group using invite code (assert MEMBER_JOINED activity, User A notified)
  try {
    console.log('--- Check 4: User B Joins Group via Invite Code ---');
    await apiRequest('/groups/join', 'POST', {
      inviteCode: invite.code
    }, userB.token);
    console.log('   User B joined group successfully');

    // Verify activity in DB
    const activities = await prisma.activity.findMany({
      where: { groupId: group.id, type: 'MEMBER_JOINED', userId: userB.id }
    });
    if (activities.length === 0) {
      throw new Error('MEMBER_JOINED activity not found in database!');
    }
    console.log('   MEMBER_JOINED activity verified in DB:', activities[0].message);

    // Verify notification for User A (User B joined)
    const notifsA = await apiRequest('/notifications', 'GET', null, userA.token);
    const joinNotif = notifsA.notifications.find(n => n.title.includes('Member Joined') || n.message.includes('joined'));
    if (!joinNotif) {
      throw new Error('User A was not notified about User B joining the group!');
    }
    console.log('   Notification sent to User A:', joinNotif.message);

    // Verify User B did not receive notification for joining themselves
    const notifsB = await apiRequest('/notifications', 'GET', null, userB.token);
    const selfJoinNotif = notifsB.notifications.find(n => n.title.includes('Member Joined'));
    if (selfJoinNotif) {
      throw new Error('User B was notified about their own join!');
    }
    console.log('   Verified User B did not receive a self-notification');
    console.log('Result: PASS\n');
  } catch (err) {
    console.error('Check 4: FAIL', err);
    process.exit(1);
  }

  // 5. User A revokes the invite (assert INVITE_REVOKED activity)
  try {
    console.log('--- Check 5: User A Revokes Group Invite ---');
    // Fetch invitations list first to get ID
    const listRes = await apiRequest(`/groups/${group.id}/invites`, 'GET', null, userA.token);
    const inviteObj = listRes.invites.find(i => i.code === invite.code);
    
    await apiRequest(`/groups/${group.id}/invites/${inviteObj.id}/revoke`, 'POST', null, userA.token);
    console.log('   Invite code revoked successfully');

    // Verify activity in DB
    const activities = await prisma.activity.findMany({
      where: { groupId: group.id, type: 'INVITE_REVOKED' }
    });
    if (activities.length === 0) {
      throw new Error('INVITE_REVOKED activity not found in database!');
    }
    console.log('   INVITE_REVOKED activity verified in DB:', activities[0].message);
    console.log('Result: PASS\n');
  } catch (err) {
    console.error('Check 5: FAIL', err);
    process.exit(1);
  }

  // 6. User A creates expense (assert EXPENSE_CREATED activity, User B notified)
  try {
    console.log('--- Check 6: User A Creates an Expense ---');
    const expenseRes = await apiRequest('/expenses', 'POST', {
      title: 'Audit Dinner',
      amount: 10000, // $100.00
      groupId: group.id,
      splitType: 'EQUAL',
      paidById: userA.id,
      participants: [
        { userId: userA.id },
        { userId: userB.id }
      ]
    }, userA.token);
    expense = expenseRes.expense;
    console.log(`   Expense created (ID: ${expense.id})`);

    // Verify activity in DB
    const activities = await prisma.activity.findMany({
      where: { groupId: group.id, type: 'EXPENSE_CREATED' }
    });
    if (activities.length === 0) {
      throw new Error('EXPENSE_CREATED activity not found in database!');
    }
    console.log('   EXPENSE_CREATED activity verified in DB:', activities[0].message);

    // Verify notification sent to User B
    const notifsB = await apiRequest('/notifications', 'GET', null, userB.token);
    const expenseNotif = notifsB.notifications.find(n => n.title.includes('Expense') || n.message.includes('dinner'));
    if (!expenseNotif) {
      throw new Error('User B was not notified about the new expense!');
    }
    console.log('   Notification sent to User B:', expenseNotif.message);
    console.log('Result: PASS\n');
  } catch (err) {
    console.error('Check 6: FAIL', err);
    process.exit(1);
  }

  // 7. User B generates settlements (assert SETTLEMENT_GENERATED activity, User A notified)
  try {
    console.log('--- Check 7: User B Generates Settlements ---');
    const settleRes = await apiRequest(`/groups/${group.id}/settlements/generate`, 'POST', null, userB.token);
    console.log('   Settlements generated:', JSON.stringify(settleRes.summary));
    settlement = settleRes.settlements[0];
    if (!settlement) {
      throw new Error('No settlement generated!');
    }
    console.log(`   Generated Settlement ID: ${settlement.id}, Payer: ${settlement.payer.name}, Payee: ${settlement.payee.name}, Amount: $${(settlement.amount/100).toFixed(2)}`);

    // Verify activity in DB
    const activities = await prisma.activity.findMany({
      where: { groupId: group.id, type: 'SETTLEMENT_GENERATED' }
    });
    if (activities.length === 0) {
      throw new Error('SETTLEMENT_GENERATED activity not found in database!');
    }
    console.log('   SETTLEMENT_GENERATED activity verified in DB:', activities[0].message);

    // Verify notification sent to User A
    const notifsA = await apiRequest('/notifications', 'GET', null, userA.token);
    const settleNotif = notifsA.notifications.find(n => n.title.includes('Settlement') || n.message.includes('recalculated'));
    if (!settleNotif) {
      throw new Error('User A was not notified about settlements recalculation!');
    }
    console.log('   Notification sent to User A:', settleNotif.message);
    console.log('Result: PASS\n');
  } catch (err) {
    console.error('Check 7: FAIL', err);
    process.exit(1);
  }

  // 8. User A uploads payment proof (assert PROOF_UPLOADED activity, User B notified)
  try {
    console.log('--- Check 8: User A Uploads Settlement Payment Proof ---');
    // Note: Settlement is from User B to User A? Wait!
    // User A paid the dinner of $100. Split equal: B owes A $50.
    // So User B is the payer, and User A is the payee.
    // Let's assert who the payer of the settlement is:
    console.log(`   Payer ID on settlement: ${settlement.payer.id}, User B ID: ${userB.id}`);
    
    // User B (debtor) should upload proof
    const proofRes = await uploadProof(settlement.id, PNG_BASE64, 'proof.png', 'image/png', userB.token);
    console.log('   Proof uploaded successfully by User B');

    // Verify activity in DB
    const activities = await prisma.activity.findMany({
      where: { groupId: group.id, type: 'PROOF_UPLOADED' }
    });
    if (activities.length === 0) {
      throw new Error('PROOF_UPLOADED activity not found in database!');
    }
    console.log('   PROOF_UPLOADED activity verified in DB:', activities[0].message);

    // Verify notification sent to User A (payee)
    const notifsA = await apiRequest('/notifications', 'GET', null, userA.token);
    const proofNotif = notifsA.notifications.find(n => n.title.includes('Proof') || n.message.includes('proof'));
    if (!proofNotif) {
      throw new Error('User A (creditor) was not notified about the payment proof!');
    }
    console.log('   Notification sent to User A:', proofNotif.message);
    console.log('Result: PASS\n');
  } catch (err) {
    console.error('Check 8: FAIL', err);
    process.exit(1);
  }

  // 9. User A confirms payment/marks PAID (assert SETTLEMENT_PAID activity, User B notified)
  try {
    console.log('--- Check 9: User A Marks Settlement Status as PAID ---');
    const updateRes = await apiRequest(`/settlements/${settlement.id}/status`, 'PATCH', {
      status: 'PAID'
    }, userA.token);
    console.log('   Settlement marked PAID by User A');

    // Verify activity in DB
    const activities = await prisma.activity.findMany({
      where: { groupId: group.id, type: 'SETTLEMENT_PAID' }
    });
    if (activities.length === 0) {
      throw new Error('SETTLEMENT_PAID activity not found in database!');
    }
    console.log('   SETTLEMENT_PAID activity verified in DB:', activities[0].message);

    // Verify notification sent to User B
    const notifsB = await apiRequest('/notifications', 'GET', null, userB.token);
    const paidNotif = notifsB.notifications.find(n => n.title.includes('Confirm') || n.message.includes('confirmed'));
    if (!paidNotif) {
      throw new Error('User B was not notified about payment confirmation!');
    }
    console.log('   Notification sent to User B:', paidNotif.message);
    console.log('Result: PASS\n');
  } catch (err) {
    console.error('Check 9: FAIL', err);
    process.exit(1);
  }

  // 10. User A updates profile name (assert PROFILE_NAME_UPDATED activity)
  try {
    console.log('--- Check 10: User A Profile Name Update Audit Log ---');
    await apiRequest('/users/profile', 'PATCH', {
      name: 'User Alpha Updated'
    }, userA.token);
    console.log('   User A updated their profile name');

    // Verify activity in DB
    const activities = await prisma.activity.findMany({
      where: { userId: userA.id, type: 'PROFILE_NAME_UPDATED' }
    });
    if (activities.length === 0) {
      throw new Error('PROFILE_NAME_UPDATED activity not found in database!');
    }
    console.log('   PROFILE_NAME_UPDATED activity verified in DB:', activities[0].message);
    console.log('Result: PASS\n');
  } catch (err) {
    console.error('Check 10: FAIL', err);
    process.exit(1);
  }

  // 11. User A uploads and removes avatar (assert PROFILE_AVATAR_UPLOADED & PROFILE_AVATAR_REMOVED activities)
  try {
    console.log('--- Check 11: User A Avatar Upload & Removal Audit Logs ---');
    await uploadAvatar(PNG_BASE64, 'avatar.png', 'image/png', userA.token);
    console.log('   Avatar uploaded successfully');

    let activities = await prisma.activity.findMany({
      where: { userId: userA.id, type: 'PROFILE_AVATAR_UPLOADED' }
    });
    if (activities.length === 0) {
      throw new Error('PROFILE_AVATAR_UPLOADED activity not found in database!');
    }
    console.log('   PROFILE_AVATAR_UPLOADED activity verified in DB:', activities[0].message);

    await apiRequest('/users/profile', 'PATCH', { removeAvatar: true }, userA.token);
    console.log('   Avatar removed successfully');

    activities = await prisma.activity.findMany({
      where: { userId: userA.id, type: 'PROFILE_AVATAR_REMOVED' }
    });
    if (activities.length === 0) {
      throw new Error('PROFILE_AVATAR_REMOVED activity not found in database!');
    }
    console.log('   PROFILE_AVATAR_REMOVED activity verified in DB:', activities[0].message);
    console.log('Result: PASS\n');
  } catch (err) {
    console.error('Check 11: FAIL', err);
    process.exit(1);
  }

  // 12. User A deletes expense (assert EXPENSE_DELETED activity)
  try {
    console.log('--- Check 12: User A Deletes Expense ---');
    await apiRequest(`/expenses/${expense.id}`, 'DELETE', null, userA.token);
    console.log('   Expense deleted successfully');

    // Verify activity in DB
    const activities = await prisma.activity.findMany({
      where: { groupId: group.id, type: 'EXPENSE_DELETED' }
    });
    if (activities.length === 0) {
      throw new Error('EXPENSE_DELETED activity not found in database!');
    }
    console.log('   EXPENSE_DELETED activity verified in DB:', activities[0].message);
    console.log('Result: PASS\n');
  } catch (err) {
    console.error('Check 12: FAIL', err);
    process.exit(1);
  }

  // 13. Notifications Read/Read All APIs
  try {
    console.log('--- Check 13: Notifications Read / Read-All API Verification ---');
    const notifs = await apiRequest('/notifications', 'GET', null, userA.token);
    console.log(`   Initial notifications for User A: ${notifs.notifications.length}`);
    const unread = notifs.notifications.filter(n => !n.read);
    console.log(`   Unread notifications: ${unread.length}`);
    
    if (unread.length === 0) {
      throw new Error('No unread notifications to test!');
    }

    const targetNotif = unread[0];
    console.log(`   Marking single notification read: ID ${targetNotif.id}`);
    const readRes = await apiRequest(`/notifications/${targetNotif.id}/read`, 'PATCH', null, userA.token);
    if (!readRes.notification.read) {
      throw new Error('Notification status not updated to read!');
    }
    console.log('   Notification successfully marked read');

    console.log('   Marking all notifications as read...');
    const readAllRes = await apiRequest('/notifications/read-all', 'PATCH', null, userA.token);
    if (!readAllRes.success) {
      throw new Error('Mark all read returned unsuccessful!');
    }
    
    const finalNotifs = await apiRequest('/notifications', 'GET', null, userA.token);
    const remainingUnread = finalNotifs.notifications.filter(n => !n.read);
    if (remainingUnread.length !== 0) {
      throw new Error(`Expected 0 unread notifications, got: ${remainingUnread.length}`);
    }
    console.log('   Verified 0 unread notifications remain');
    console.log('Result: PASS\n');
  } catch (err) {
    console.error('Check 13: FAIL', err);
    process.exit(1);
  }

  // 14. Group Activity retrieval API (GET /api/groups/:groupId/activity)
  try {
    console.log('--- Check 14: Retrieve Group Activities Timeline via API ---');
    const activityRes = await apiRequest(`/groups/${group.id}/activity`, 'GET', null, userA.token);
    const fetched = activityRes.activities;
    console.log(`   Retrieved ${fetched.length} activities for group omega`);
    if (fetched.length === 0) {
      throw new Error('No activities returned from API!');
    }
    
    // Assert user detail is included
    const sample = fetched[0];
    if (!sample.user || !sample.user.name) {
      throw new Error('User relationship detail not included in activities response!');
    }
    console.log('   Sample activity contains user relation:', sample.user.name);
    console.log('Result: PASS\n');
  } catch (err) {
    console.error('Check 14: FAIL', err);
    process.exit(1);
  }

  console.log('================================================================');
  console.log('ALL PHASE 17 INTEGRATION & AUDIT LOG CHECKS PASSED SUCCESSFULLY!');
  console.log('================================================================');
}

run();
