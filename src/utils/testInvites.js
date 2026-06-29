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
  console.log('=== Starting Phase 9: Group Invites & Secure Invite Codes Verification ===\n');

  const timestamp = Date.now();
  const ownerEmail = `owner_${timestamp}@example.com`;
  const invitee1Email = `invitee1_${timestamp}@example.com`;
  const invitee2Email = `invitee2_${timestamp}@example.com`;
  const password = 'Password123';

  let ownerToken, invitee1Token, invitee2Token;
  let ownerId, invitee1Id, invitee2Id;
  let groupId;
  let generalCode, emailSpecificCode, revokedCode;
  let generalInviteId, emailInviteId, revokedInviteId;

  try {
    // 1. Register Users
    console.log('1. Registering test users...');
    const ownerReg = await apiRequest('/auth/register', 'POST', {
      email: ownerEmail,
      password,
      name: 'Group Owner'
    });
    ownerId = ownerReg.user.id;
    console.log(`   Registered Owner: ${ownerEmail} (${ownerId})`);

    const inv1Reg = await apiRequest('/auth/register', 'POST', {
      email: invitee1Email,
      password,
      name: 'Invitee One'
    });
    invitee1Id = inv1Reg.user.id;
    console.log(`   Registered Invitee 1: ${invitee1Email} (${invitee1Id})`);

    const inv2Reg = await apiRequest('/auth/register', 'POST', {
      email: invitee2Email,
      password,
      name: 'Invitee Two'
    });
    invitee2Id = inv2Reg.user.id;
    console.log(`   Registered Invitee 2: ${invitee2Email} (${invitee2Id})`);

    // 2. Login Users
    console.log('\n2. Logging in users to retrieve tokens...');
    const ownerLogin = await apiRequest('/auth/login', 'POST', {
      email: ownerEmail,
      password
    });
    ownerToken = ownerLogin.accessToken;

    const inv1Login = await apiRequest('/auth/login', 'POST', {
      email: invitee1Email,
      password
    });
    invitee1Token = inv1Login.accessToken;

    const inv2Login = await apiRequest('/auth/login', 'POST', {
      email: invitee2Email,
      password
    });
    invitee2Token = inv2Login.accessToken;

    // 3. Create Group
    console.log('\n3. Creating a new group...');
    const groupRes = await apiRequest('/groups', 'POST', {
      name: 'Trip to Tokyo',
      description: 'Tokyo trip expenses'
    }, ownerToken);
    groupId = groupRes.group.id;
    console.log(`   Group created successfully! ID: ${groupId}`);

    // 4. Owner lists invites (should be empty)
    console.log('\n4. Listing invites (should be empty initially)...');
    const emptyInvites = await apiRequest(`/groups/${groupId}/invites`, 'GET', null, ownerToken);
    console.log(`   Invites count: ${emptyInvites.invites.length}`);
    if (emptyInvites.invites.length !== 0) throw new Error('Expected 0 invites');

    // 5. Owner creates general invite
    console.log('\n5. Creating a general invite...');
    const genRes = await apiRequest(`/groups/${groupId}/invite`, 'POST', {
      expiresInHours: 1
    }, ownerToken);
    generalCode = genRes.invite.code;
    generalInviteId = genRes.invite.id;
    console.log(`   General Invite created: code = ${generalCode}, status = ${genRes.invite.status}`);
    if (genRes.invite.status !== 'ACTIVE') throw new Error('Expected invite to be ACTIVE');

    // 6. Owner creates email-specific invite
    console.log('\n6. Creating an email-specific invite...');
    const emailRes = await apiRequest(`/groups/${groupId}/invite`, 'POST', {
      email: invitee1Email,
      expiresInHours: 1
    }, ownerToken);
    emailSpecificCode = emailRes.invite.code;
    emailInviteId = emailRes.invite.id;
    console.log(`   Email Invite created: code = ${emailSpecificCode}, email = ${emailRes.invite.email}, status = ${emailRes.invite.status}`);
    if (emailRes.invite.email !== invitee1Email) throw new Error('Expected matching email address');

    // 7. Owner creates and then revokes a general invite
    console.log('\n7. Creating and immediately revoking an invite...');
    const revRes = await apiRequest(`/groups/${groupId}/invite`, 'POST', {
      expiresInHours: 24
    }, ownerToken);
    revokedCode = revRes.invite.code;
    revokedInviteId = revRes.invite.id;
    console.log(`   Created invite to revoke: code = ${revokedCode}`);

    const revokeConfirm = await apiRequest(`/groups/${groupId}/invites/${revokedInviteId}/revoke`, 'POST', {}, ownerToken);
    console.log(`   Revoked invite: status = ${revokeConfirm.invite.status}`);
    if (revokeConfirm.invite.status !== 'REVOKED') throw new Error('Expected status to be REVOKED');

    // 8. Attempt non-owner access (should fail)
    console.log('\n8. Testing non-owner permission restrictions (should fail with 403)...');
    try {
      await apiRequest(`/groups/${groupId}/invite`, 'POST', { expiresInHours: 24 }, invitee1Token);
      throw new Error('Non-owner was allowed to create invites!');
    } catch (err) {
      if (err.status === 403) {
        console.log('   ✓ Successfully blocked non-owner from creating invite (403)');
      } else {
        throw err;
      }
    }

    try {
      await apiRequest(`/groups/${groupId}/invites`, 'GET', null, invitee1Token);
      throw new Error('Non-owner was allowed to list invites!');
    } catch (err) {
      if (err.status === 403) {
        console.log('   ✓ Successfully blocked non-owner from listing invites (403)');
      } else {
        throw err;
      }
    }

    try {
      await apiRequest(`/groups/${groupId}/invites/${generalInviteId}/revoke`, 'POST', {}, invitee1Token);
      throw new Error('Non-owner was allowed to revoke invite!');
    } catch (err) {
      if (err.status === 403) {
        console.log('   ✓ Successfully blocked non-owner from revoking invite (403)');
      } else {
        throw err;
      }
    }

    // 9. Attacker/Invitee 2 attempts to use Invitee 1's email-specific invite (should fail)
    console.log(`\n9. Invitee 2 (${invitee2Email}) attempts to use Invitee 1's email invite (should fail with 403)...`);
    try {
      await apiRequest('/groups/join', 'POST', { inviteCode: emailSpecificCode }, invitee2Token);
      throw new Error('Invitee 2 successfully joined using Invitee 1 email invite!');
    } catch (err) {
      if (err.status === 403) {
        console.log('   ✓ Successfully rejected incorrect email invite redemption (403)');
      } else {
        throw err;
      }
    }

    // 10. Invitee 1 uses their email-specific invite (should succeed)
    console.log(`\n10. Invitee 1 (${invitee1Email}) uses their email-specific invite...`);
    const join1Res = await apiRequest('/groups/join', 'POST', { inviteCode: emailSpecificCode }, invitee1Token);
    console.log(`    Joined group ID: ${join1Res.groupId}. Message: "${join1Res.message}"`);
    if (join1Res.groupId !== groupId) throw new Error('Joined incorrect group');

    // 11. Invitee 1 attempts to join group again (should fail with 400 - duplicate membership)
    console.log('\n11. Invitee 1 attempts to join again using general invite...');
    try {
      await apiRequest('/groups/join', 'POST', { inviteCode: generalCode }, invitee1Token);
      throw new Error('Invitee 1 joined group twice!');
    } catch (err) {
      if (err.status === 400) {
        console.log('    ✓ Successfully blocked duplicate group membership (400)');
      } else {
        throw err;
      }
    }

    // 12. Invitee 2 attempts to use revoked invite (should fail with 400)
    console.log('\n12. Invitee 2 attempts to use revoked invite code...');
    try {
      await apiRequest('/groups/join', 'POST', { inviteCode: revokedCode }, invitee2Token);
      throw new Error('Invitee 2 joined using a revoked invite!');
    } catch (err) {
      if (err.status === 400) {
        console.log('    ✓ Successfully rejected revoked invite redemption (400)');
      } else {
        throw err;
      }
    }

    // 13. Invitee 2 uses the general invite (should succeed)
    console.log('\n13. Invitee 2 uses the general invite code...');
    const join2Res = await apiRequest('/groups/join', 'POST', { inviteCode: generalCode }, invitee2Token);
    console.log(`    Joined group ID: ${join2Res.groupId}. Message: "${join2Res.message}"`);
    if (join2Res.groupId !== groupId) throw new Error('Joined incorrect group');

    // 14. Owner lists invites to check final statuses
    console.log('\n14. Owner lists invites to verify derived statuses...');
    const finalInvitesRes = await apiRequest(`/groups/${groupId}/invites`, 'GET', null, ownerToken);
    const finalInvites = finalInvitesRes.invites;
    console.log('    List of invites from server:');
    finalInvites.forEach(inv => {
      console.log(`    - ID: ${inv.id} | Code: ${inv.code} | Target Email: ${inv.email} | Status: ${inv.status} | Expires: ${inv.expiresAt}`);
    });

    const genInv = finalInvites.find(i => i.id === generalInviteId);
    const emailInv = finalInvites.find(i => i.id === emailInviteId);
    const revInv = finalInvites.find(i => i.id === revokedInviteId);

    if (genInv.status !== 'USED') throw new Error(`Expected general invite to be USED, got ${genInv.status}`);
    if (emailInv.status !== 'USED') throw new Error(`Expected email-specific invite to be USED, got ${emailInv.status}`);
    if (revInv.status !== 'REVOKED') throw new Error(`Expected revoked invite to be REVOKED, got ${revInv.status}`);

    console.log('\n=== ALL SCRIPTS & LOGICAL TESTS PASSED SUCCESSFULLY! ===');
  } catch (error) {
    console.error('\n❌ Verification Failed!');
    if (error.data) {
      console.error('Response Error Data:', error.data);
    } else {
      console.error(error);
    }
    process.exit(1);
  }
}

runTests();
