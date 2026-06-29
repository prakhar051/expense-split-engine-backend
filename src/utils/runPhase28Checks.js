require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const http = require('http');
const express = require('express');
const prisma = require('../utils/prisma');
const socketServer = require('../socket/socketServer');

const TEST_PORT = 5058;
const BASE_URL = `http://localhost:${TEST_PORT}`;
const JWT_SECRET = process.env.JWT_SECRET || 'dev_access_token_secret_987654321_abc';

function printPass(testName) {
  console.log(`✓ ${testName}: PASS`);
}

function printFail(testName, error) {
  console.error(`✗ ${testName}: FAIL`);
  console.error(`  Reason: ${error.message || error}`);
}

async function fetchJson(path, options = {}) {
  const url = `${BASE_URL}${path}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers
    }
  });
  let data = null;
  try {
    data = await response.json();
  } catch (e) {
    // Non-JSON response
  }
  return { status: response.status, data };
}

async function run() {
  console.log('================================================================');
  console.log('PHASE 28 ENTERPRISE RBAC & GROUP ADMIN VERIFICATION CHECKS');
  console.log('================================================================\n');

  let passedAll = true;

  // Mock Socket Server to spy on broadcasts (Must be done BEFORE requiring routes/services to affect destructured imports)
  const socketEventsEmitted = [];
  const originalBroadcastToGroup = socketServer.broadcastToGroup;
  const originalSendToUser = socketServer.sendToUser;

  socketServer.broadcastToGroup = (groupId, event, payload, initiatorUserId) => {
    socketEventsEmitted.push({ type: 'GROUP', groupId, event, payload, initiatorUserId });
  };
  socketServer.sendToUser = (userId, event, payload, initiatorUserId) => {
    socketEventsEmitted.push({ type: 'USER', userId, event, payload, initiatorUserId });
  };

  // 1. Initialize Express test server
  const app = express();
  app.use(express.json());

  // Mount route under test
  const groupAdminRoutes = require('../routes/groupAdminRoutes');
  app.use('/api/groups', groupAdminRoutes);

  // Error handling middleware
  app.use((err, req, res, next) => {
    res.status(err.status || 500).json({ success: false, message: err.message });
  });

  const server = http.createServer(app);
  await new Promise((resolve) => {
    server.listen(TEST_PORT, () => {
      console.log(`[Test Server] Running on port ${TEST_PORT}\n`);
      resolve();
    });
  });




  // 2. Generate test entities
  const ownerId = crypto.randomUUID();
  const adminId = crypto.randomUUID();
  const memberId = crypto.randomUUID();
  const targetId = crypto.randomUUID(); // Member 2
  const bannedUserId = crypto.randomUUID();

  const ownerToken = jwt.sign({ id: ownerId, email: 'owner@test.com' }, JWT_SECRET, { expiresIn: '1h' });
  const adminToken = jwt.sign({ id: adminId, email: 'admin@test.com' }, JWT_SECRET, { expiresIn: '1h' });
  const memberToken = jwt.sign({ id: memberId, email: 'member@test.com' }, JWT_SECRET, { expiresIn: '1h' });
  const bannedToken = jwt.sign({ id: bannedUserId, email: 'banned@test.com' }, JWT_SECRET, { expiresIn: '1h' });

  const ownerHeaders = { 'Authorization': `Bearer ${ownerToken}` };
  const adminHeaders = { 'Authorization': `Bearer ${adminToken}` };
  const memberHeaders = { 'Authorization': `Bearer ${memberToken}` };
  const bannedHeaders = { 'Authorization': `Bearer ${bannedToken}` };

  const groupId = crypto.randomUUID();

  try {
    // 3. Seed Database
    await prisma.$transaction([
      prisma.user.create({ data: { id: ownerId, name: 'Test Owner', email: 'owner@test.com', password: 'hashed' } }),
      prisma.user.create({ data: { id: adminId, name: 'Test Admin', email: 'admin@test.com', password: 'hashed' } }),
      prisma.user.create({ data: { id: memberId, name: 'Test Member', email: 'member@test.com', password: 'hashed' } }),
      prisma.user.create({ data: { id: targetId, name: 'Test Target', email: 'target@test.com', password: 'hashed' } }),
      prisma.user.create({ data: { id: bannedUserId, name: 'Banned User', email: 'banned@test.com', password: 'hashed' } }),

      prisma.group.create({ data: { id: groupId, name: 'RBAC Test Group', createdById: ownerId, version: 1 } }),

      prisma.groupMember.create({ data: { groupId, userId: ownerId, role: 'OWNER' } }),
      prisma.groupMember.create({ data: { groupId, userId: adminId, role: 'ADMIN' } }),
      prisma.groupMember.create({ data: { groupId, userId: memberId, role: 'MEMBER' } }),
      prisma.groupMember.create({ data: { groupId, userId: targetId, role: 'MEMBER' } }),
      prisma.groupMember.create({ data: { groupId, userId: bannedUserId, role: 'MEMBER', isBanned: true } })
    ]);
    printPass('Prisma Database Seeding');
  } catch (err) {
    printFail('Prisma Database Seeding', err);
    passedAll = false;
  }

  // 4. Test: Get group members
  try {
    const res = await fetchJson(`/api/groups/${groupId}/members`, { headers: ownerHeaders });
    if (res.status === 200 && res.data.members.length === 5) {
      printPass('Get Group Members List');
    } else {
      throw new Error(`Expected 5 members, got status ${res.status} and ${res.data?.members?.length} members`);
    }
  } catch (err) {
    printFail('Get Group Members List', err);
    passedAll = false;
  }

  // 5. Test: Banned user is denied access (HTTP 403)
  try {
    const res = await fetchJson(`/api/groups/${groupId}/members`, { headers: bannedHeaders });
    if (res.status === 403) {
      printPass('Banned Member blocked with HTTP 403');
    } else {
      throw new Error(`Expected status 403, got ${res.status}`);
    }
  } catch (err) {
    printFail('Banned Member blocked with HTTP 403', err);
    passedAll = false;
  }

  // 6. Test: Promote Member to Admin (Owner only)
  try {
    const group = await prisma.group.findUnique({ where: { id: groupId } });
    const version = group.version;

    // A. Member attempts promotion -> 403
    const resMember = await fetchJson(`/api/groups/${groupId}/members/${targetId}/promote`, {
      method: 'PATCH',
      headers: { ...memberHeaders, 'If-Match': String(version) }
    });
    if (resMember.status !== 403) {
      throw new Error(`Member got status ${resMember.status} instead of 403`);
    }

    // B. Admin attempts promotion -> 403
    const resAdmin = await fetchJson(`/api/groups/${groupId}/members/${targetId}/promote`, {
      method: 'PATCH',
      headers: { ...adminHeaders, 'If-Match': String(version) }
    });
    if (resAdmin.status !== 403) {
      throw new Error(`Admin got status ${resAdmin.status} instead of 403`);
    }

    // C. Owner promotes Member -> 200
    const resOwner = await fetchJson(`/api/groups/${groupId}/members/${targetId}/promote`, {
      method: 'PATCH',
      headers: { ...ownerHeaders, 'If-Match': String(version) }
    });
    if (resOwner.status === 200) {
      const updatedMember = await prisma.groupMember.findUnique({
        where: { groupId_userId: { groupId, userId: targetId } }
      });
      const updatedGroup = await prisma.group.findUnique({ where: { id: groupId } });

      if (updatedMember.role === 'ADMIN' && updatedGroup.version === version + 1) {
        printPass('Promote Member to Admin (with group version increment)');
      } else {
        throw new Error(`Role is ${updatedMember.role}, version is ${updatedGroup.version}`);
      }
    } else {
      throw new Error(`Owner promotion failed with status ${resOwner.status}: ${JSON.stringify(resOwner.data)}`);
    }
  } catch (err) {
    printFail('Promote Member to Admin', err);
    passedAll = false;
  }

  // 7. Test: Demote Admin to Member (Owner only)
  try {
    const group = await prisma.group.findUnique({ where: { id: groupId } });
    const version = group.version;

    // Owner demotes target (who was promoted to ADMIN in previous test)
    const res = await fetchJson(`/api/groups/${groupId}/members/${targetId}/demote`, {
      method: 'PATCH',
      headers: { ...ownerHeaders, 'If-Match': String(version) }
    });

    if (res.status === 200) {
      const updatedMember = await prisma.groupMember.findUnique({
        where: { groupId_userId: { groupId, userId: targetId } }
      });
      if (updatedMember.role === 'MEMBER') {
        printPass('Demote Admin to Member');
      } else {
        throw new Error(`Role is ${updatedMember.role}`);
      }
    } else {
      throw new Error(`Owner demotion failed with status ${res.status}`);
    }
  } catch (err) {
    printFail('Demote Admin to Member', err);
    passedAll = false;
  }

  // 8. Test: Concurrent role updates / Optimistic Concurrency Control (OCC 409 Conflict)
  try {
    const group = await prisma.group.findUnique({ where: { id: groupId } });
    const correctVersion = group.version;
    const staleVersion = correctVersion - 1;

    const res = await fetchJson(`/api/groups/${groupId}/members/${targetId}/promote`, {
      method: 'PATCH',
      headers: { ...ownerHeaders, 'If-Match': String(staleVersion) }
    });

    if (res.status === 409) {
      printPass('Optimistic Concurrency Control returns 409 Conflict');
    } else {
      throw new Error(`Expected status 409, got ${res.status}`);
    }
  } catch (err) {
    printFail('Optimistic Concurrency Control returns 409 Conflict', err);
    passedAll = false;
  }

  // 9. Test: Ban and Unban Member
  try {
    const group = await prisma.group.findUnique({ where: { id: groupId } });
    const version = group.version;

    // A. Owner bans Test Member
    const resBan = await fetchJson(`/api/groups/${groupId}/members/${memberId}/ban`, {
      method: 'POST',
      headers: { ...ownerHeaders, 'If-Match': String(version) },
      body: JSON.stringify({ reason: 'Disruptive behavior' })
    });

    if (resBan.status === 200) {
      const memberRecord = await prisma.groupMember.findUnique({
        where: { groupId_userId: { groupId, userId: memberId } }
      });
      if (memberRecord.isBanned === true && memberRecord.banReason === 'Disruptive behavior') {
        printPass('Ban Member preserves history and reason');
      } else {
        throw new Error(`Banned state mismatch. isBanned=${memberRecord.isBanned}, reason=${memberRecord.banReason}`);
      }
    } else {
      throw new Error(`Ban failed with status ${resBan.status}`);
    }

    // B. Verify banned member now receives HTTP 403 on group endpoints
    const resGet = await fetchJson(`/api/groups/${groupId}/members`, {
      headers: { 'Authorization': `Bearer ${memberToken}` }
    });
    if (resGet.status === 403) {
      printPass('Banned user loses active group access immediately');
    } else {
      throw new Error(`Banned user got status ${resGet.status} instead of 403`);
    }

    // C. Owner unbans Test Member
    const updatedGroup = await prisma.group.findUnique({ where: { id: groupId } });
    const currentVersion = updatedGroup.version;

    const resUnban = await fetchJson(`/api/groups/${groupId}/members/${memberId}/unban`, {
      method: 'POST',
      headers: { ...ownerHeaders, 'If-Match': String(currentVersion) }
    });

    if (resUnban.status === 200) {
      const memberRecord = await prisma.groupMember.findUnique({
        where: { groupId_userId: { groupId, userId: memberId } }
      });
      if (memberRecord.isBanned === false && memberRecord.banReason === 'Disruptive behavior') {
        printPass('Unban Member updates flag but preserves historical audit reason');
      } else {
        throw new Error(`Unbanned state mismatch. isBanned=${memberRecord.isBanned}`);
      }
    } else {
      throw new Error(`Unban failed with status ${resUnban.status}`);
    }
  } catch (err) {
    printFail('Ban and Unban Member', err);
    passedAll = false;
  }

  // 10. Test: Self modification restrictions (Owner cannot ban or remove self)
  try {
    const group = await prisma.group.findUnique({ where: { id: groupId } });
    const version = group.version;

    // A. Owner tries to ban self
    const resBanSelf = await fetchJson(`/api/groups/${groupId}/members/${ownerId}/ban`, {
      method: 'POST',
      headers: { ...ownerHeaders, 'If-Match': String(version) },
      body: JSON.stringify({ reason: 'Self ban test' })
    });
    // B. Owner tries to remove self
    const resRemoveSelf = await fetchJson(`/api/groups/${groupId}/members/${ownerId}`, {
      method: 'DELETE',
      headers: { ...ownerHeaders, 'If-Match': String(version) }
    });

    const isBanSelfRejected = resBanSelf.status === 400 || resBanSelf.status === 403;
    const isRemoveSelfRejected = resRemoveSelf.status === 400 || resRemoveSelf.status === 403;

    if (isBanSelfRejected && isRemoveSelfRejected) {
      printPass('Owner cannot ban or remove self');
    } else {
      throw new Error(`Self-ban status=${resBanSelf.status}, Self-remove status=${resRemoveSelf.status}`);
    }
  } catch (err) {
    printFail('Owner cannot ban or remove self', err);
    passedAll = false;
  }

  // 11. Test: Admin permission constraints (Admin cannot modify Owner or another Admin)
  try {
    const group = await prisma.group.findUnique({ where: { id: groupId } });
    const version = group.version;

    // A. Admin tries to ban Owner
    const resBanOwner = await fetchJson(`/api/groups/${groupId}/members/${ownerId}/ban`, {
      method: 'POST',
      headers: { ...adminHeaders, 'If-Match': String(version) },
      body: JSON.stringify({ reason: 'Ban owner' })
    });

    // B. Admin promotes target to ADMIN first so they are peers
    const group2 = await prisma.group.findUnique({ where: { id: groupId } });
    await prisma.groupMember.update({
      where: { groupId_userId: { groupId, userId: targetId } },
      data: { role: 'ADMIN' }
    });

    // Admin tries to remove another Admin (target)
    const resRemovePeer = await fetchJson(`/api/groups/${groupId}/members/${targetId}`, {
      method: 'DELETE',
      headers: { ...adminHeaders, 'If-Match': String(group2.version) }
    });

    const isBanOwnerRejected = resBanOwner.status === 403;
    const isRemovePeerRejected = resRemovePeer.status === 403;

    if (isBanOwnerRejected && isRemovePeerRejected) {
      printPass('Admin cannot modify group Owner or Peer Admins');
    } else {
      throw new Error(`BanOwner status=${resBanOwner.status}, RemovePeer status=${resRemovePeer.status}`);
    }
  } catch (err) {
    printFail('Admin cannot modify group Owner or Peer Admins', err);
    passedAll = false;
  }

  // 12. Test: Audit logs & Activity Logs & Notifications dispatch verification
  try {
    const adminActionsCount = await prisma.adminAction.count({ where: { groupId } });
    const activityLogsCount = await prisma.activity.count({ where: { groupId } });
    const notificationsCount = await prisma.notification.count({ where: { userId: memberId } });

    if (adminActionsCount > 0 && activityLogsCount > 0 && notificationsCount > 0) {
      printPass('Audit logs, Activity timelines, and Notifications generated correctly');
    } else {
      throw new Error(`Counts - Actions: ${adminActionsCount}, Activities: ${activityLogsCount}, Notifications: ${notificationsCount}`);
    }
  } catch (err) {
    printFail('Audit logs, Activity timelines, and Notifications generated correctly', err);
    passedAll = false;
  }

  // 13. Test: Socket broadcasts verification
  try {
    const roleUpdatedEvent = socketEventsEmitted.find(e => e.event === 'GROUP_ROLE_UPDATED');
    const ownerTransferredEvent = socketEventsEmitted.find(e => e.event === 'GROUP_OWNER_TRANSFERRED'); // we will trigger transfer in next test

    if (roleUpdatedEvent && roleUpdatedEvent.payload.groupVersion) {
      printPass('Socket broadcasts dispatched with standard payload properties');
    } else {
      throw new Error(`Events dispatched: ${JSON.stringify(socketEventsEmitted)}`);
    }
  } catch (err) {
    printFail('Socket broadcasts dispatched with standard payload properties', err);
    passedAll = false;
  }

  // 14. Test: Ownership transfer
  try {
    // Reset target to Member first
    await prisma.groupMember.update({
      where: { groupId_userId: { groupId, userId: targetId } },
      data: { role: 'MEMBER' }
    });

    const group = await prisma.group.findUnique({ where: { id: groupId } });
    const version = group.version;

    // Owner transfers ownership to target Member
    const res = await fetchJson(`/api/groups/${groupId}/transfer-owner`, {
      method: 'PATCH',
      headers: { ...ownerHeaders, 'If-Match': String(version) },
      body: JSON.stringify({ newOwnerId: targetId })
    });

    if (res.status === 200) {
      const formerOwner = await prisma.groupMember.findUnique({
        where: { groupId_userId: { groupId, userId: ownerId } }
      });
      const newOwner = await prisma.groupMember.findUnique({
        where: { groupId_userId: { groupId, userId: targetId } }
      });

      if (formerOwner.role === 'MEMBER' && newOwner.role === 'OWNER') {
        printPass('Ownership transferred successfully (Owner demoted to Member)');
      } else {
        throw new Error(`Former Owner role=${formerOwner.role}, New Owner role=${newOwner.role}`);
      }
    } else {
      throw new Error(`Transfer failed with status ${res.status}: ${JSON.stringify(res.data)}`);
    }
  } catch (err) {
    printFail('Ownership transferred successfully', err);
    passedAll = false;
  }

  // 15. Teardown Database
  try {
    await prisma.adminAction.deleteMany({ where: { groupId } });
    await prisma.activity.deleteMany({ where: { groupId } });
    await prisma.groupMember.deleteMany({ where: { groupId } });
    await prisma.group.delete({ where: { id: groupId } });
    await prisma.user.deleteMany({
      where: {
        id: { in: [ownerId, adminId, memberId, targetId, bannedUserId] }
      }
    });
    printPass('Database teardown cleanly purged all test resources');
  } catch (err) {
    printFail('Database teardown cleanly purged all test resources', err);
    passedAll = false;
  }

  // Restore socket server mock
  socketServer.broadcastToGroup = originalBroadcastToGroup;
  socketServer.sendToUser = originalSendToUser;

  // Stop test server
  await new Promise((resolve) => {
    server.close(() => {
      console.log('\n[Test Server] Stopped.');
      resolve();
    });
  });

  console.log('\n================================================================');
  if (passedAll) {
    console.log('✓ ALL VERIFICATION CHECKS COMPLETED SUCCESSFULLY!');
    console.log('================================================================');
    process.exit(0);
  } else {
    console.error('✗ SOME VERIFICATION CHECKS FAILED!');
    console.error('================================================================');
    process.exit(1);
  }
}

run().catch((err) => {
  console.error('Unhandled script error:', err);
  process.exit(1);
});
