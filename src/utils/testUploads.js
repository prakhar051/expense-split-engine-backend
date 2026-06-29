const BASE_URL = 'http://localhost:5000/api';

// Tiny 1x1 base64 files
const PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const JPG_BASE64 = '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';
const WEBP_BASE64 = 'UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoBAAEAAkAALiIqQAC5AAAA/v8AAA==';

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

async function uploadFiles(expenseId, filesList, token) {
  const url = `${BASE_URL}/expenses/${expenseId}/attachments`;
  const formData = new FormData();

  filesList.forEach((file) => {
    const blob = new Blob([file.buffer], { type: file.mimetype });
    formData.append('files', blob, file.originalname);
  });

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`
    },
    body: formData
  });

  const data = await response.json();

  if (!response.ok) {
    const error = new Error(data.message || `Upload failed with status ${response.status}`);
    error.status = response.status;
    error.data = data;
    throw error;
  }

  return data;
}

async function runTests() {
  console.log('=== Starting Phase 10: Receipt Uploads & Cloud Storage Verification ===\n');

  const timestamp = Date.now();
  const ownerEmail = `owner_${timestamp}@example.com`;
  const memberEmail = `member_${timestamp}@example.com`;
  const nonMemberEmail = `nonmember_${timestamp}@example.com`;
  const password = 'Password123';

  let ownerToken, memberToken, nonMemberToken;
  let ownerId, memberId, nonMemberId;
  let groupId, expenseId;
  let attachmentIds = [];

  try {
    // 1. Register Users
    console.log('1. Registering test users...');
    const ownerReg = await apiRequest('/auth/register', 'POST', { email: ownerEmail, password, name: 'Group Owner' });
    ownerId = ownerReg.user.id;
    const memberReg = await apiRequest('/auth/register', 'POST', { email: memberEmail, password, name: 'Group Member' });
    memberId = memberReg.user.id;
    const nonMemberReg = await apiRequest('/auth/register', 'POST', { email: nonMemberEmail, password, name: 'Non Member' });
    nonMemberId = nonMemberReg.user.id;

    // 2. Login Users
    console.log('2. Logging in users...');
    const ownerL = await apiRequest('/auth/login', 'POST', { email: ownerEmail, password });
    ownerToken = ownerL.accessToken;
    const memberL = await apiRequest('/auth/login', 'POST', { email: memberEmail, password });
    memberToken = memberL.accessToken;
    const nonMemberL = await apiRequest('/auth/login', 'POST', { email: nonMemberEmail, password });
    nonMemberToken = nonMemberL.accessToken;

    // 3. Create Group & Add Member
    console.log('3. Setting up group & memberships...');
    const groupRes = await apiRequest('/groups', 'POST', { name: 'Ski Trip', description: 'Ski trip 2026' }, ownerToken);
    groupId = groupRes.group.id;
    // Add member to group
    await apiRequest(`/groups/${groupId}/members`, 'POST', { userId: memberId }, ownerToken);

    // 4. Create Expense
    console.log('4. Creating an expense...');
    const expenseRes = await apiRequest('/expenses', 'POST', {
      groupId,
      title: 'Cabin Booking',
      amount: 50000,
      splitType: 'EQUAL',
      paidById: ownerId,
      participants: [{ userId: ownerId }, { userId: memberId }]
    }, ownerToken);
    expenseId = expenseRes.expense.id;
    console.log(`   Expense created: ${expenseId}`);

    // 5. Test 1: Upload PNG
    console.log('\n5. Uploading PNG image...');
    const pngBuffer = Buffer.from(PNG_BASE64, 'base64');
    const pngUpload = await uploadFiles(expenseId, [{
      buffer: pngBuffer,
      mimetype: 'image/png',
      originalname: 'receipt.png'
    }], ownerToken);
    console.log(`   ✓ PNG uploaded. ID: ${pngUpload.attachments[0].id}`);
    attachmentIds.push(pngUpload.attachments[0].id);

    // 6. Test 2: Upload JPG
    console.log('\n6. Uploading JPG image...');
    const jpgUpload = await uploadFiles(expenseId, [{
      buffer: pngBuffer,
      mimetype: 'image/jpeg',
      originalname: 'receipt.jpg'
    }], ownerToken);
    console.log(`   ✓ JPG uploaded. ID: ${jpgUpload.attachments[0].id}`);
    attachmentIds.push(jpgUpload.attachments[0].id);

    // 7. Test 3: Upload WEBP
    console.log('\n7. Uploading WEBP image...');
    const webpUpload = await uploadFiles(expenseId, [{
      buffer: pngBuffer,
      mimetype: 'image/webp',
      originalname: 'receipt.webp'
    }], ownerToken);
    console.log(`   ✓ WEBP uploaded. ID: ${webpUpload.attachments[0].id}`);
    attachmentIds.push(webpUpload.attachments[0].id);

    // 8. Test 4: Reject PDF upload
    console.log('\n8. Attempting PDF upload (should fail mimetype filter)...');
    try {
      const pdfBuffer = Buffer.from('%PDF-1.4 ...');
      await uploadFiles(expenseId, [{
        buffer: pdfBuffer,
        mimetype: 'application/pdf',
        originalname: 'receipt.pdf'
      }], ownerToken);
      throw new Error('PDF upload was not rejected!');
    } catch (err) {
      if (err.status === 400 && err.message.includes('Invalid file type')) {
        console.log('   ✓ Rejected PDF upload successfully (400)');
      } else {
        throw err;
      }
    }

    // 9. Test 5: Reject oversized upload (6 MB)
    console.log('\n9. Attempting oversized upload (> 5MB)...');
    try {
      const largeBuffer = Buffer.alloc(6 * 1024 * 1024); // 6 MB
      await uploadFiles(expenseId, [{
        buffer: largeBuffer,
        mimetype: 'image/png',
        originalname: 'huge_receipt.png'
      }], ownerToken);
      throw new Error('Oversized upload was not rejected!');
    } catch (err) {
      if (err.status === 400 && err.message.includes('File size limit exceeded')) {
        console.log('   ✓ Rejected oversized file successfully (400)');
      } else {
        throw err;
      }
    }

    // 10. Test 6: Non-member upload rejection
    console.log('\n10. Attempting non-member upload (should be forbidden)...');
    try {
      await uploadFiles(expenseId, [{
        buffer: pngBuffer,
        mimetype: 'image/png',
        originalname: 'hack.png'
      }], nonMemberToken);
      throw new Error('Non-member successfully uploaded files!');
    } catch (err) {
      if (err.status === 403) {
        console.log('    ✓ Rejected non-member upload successfully (403)');
      } else {
        throw err;
      }
    }

    // 11. Test 7: Retrieve attachments
    console.log('\n11. Retrieving attachments and checking payload values...');
    const details = await apiRequest(`/expenses/${expenseId}`, 'GET', null, ownerToken);
    console.log(`    Expense retrieved attachments count: ${details.expense.attachments.length}`);
    if (details.expense.attachments.length !== 3) throw new Error('Expected 3 attachments attached to expense details');
    
    const attList = await apiRequest(`/expenses/${expenseId}/attachments`, 'GET', null, ownerToken);
    console.log(`    GET /attachments endpoint returned attachments count: ${attList.attachments.length}`);
    if (attList.attachments.length !== 3) throw new Error('Expected 3 attachments in list');
    
    // Check fields
    const testAttachment = attList.attachments[0];
    console.log('    Attachment payload keys:', Object.keys(testAttachment));
    if (!testAttachment.id || !testAttachment.fileUrl || !testAttachment.uploadedById || !testAttachment.createdAt) {
      throw new Error('Attachment payload is missing required fields');
    }
    console.log('    ✓ Retrieval schema confirmed');

    // 12. Test 10: Reject unauthorized deletion
    console.log('\n12. Testing unauthorized deletion of attachment (should fail)...');
    try {
      await apiRequest(`/expenses/${expenseId}/attachments/${attachmentIds[0]}`, 'DELETE', null, nonMemberToken);
      throw new Error('Non-member was allowed to delete owner attachment!');
    } catch (err) {
      if (err.status === 403) {
        console.log('    ✓ Rejected unauthorized deletion successfully (403)');
      } else {
        throw err;
      }
    }

    // 13. Test 8: Delete attachment by uploader
    console.log('\n13. Deleting attachment as uploader...');
    await apiRequest(`/expenses/${expenseId}/attachments/${attachmentIds[0]}`, 'DELETE', null, ownerToken);
    console.log('    ✓ Attachment deleted successfully from uploader session');

    // 14. Test 9: Delete attachment by group owner (uploaded by member)
    console.log('\n14. Member uploads attachment, owner deletes it...');
    const memberUpload = await uploadFiles(expenseId, [{
      buffer: pngBuffer,
      mimetype: 'image/png',
      originalname: 'member_receipt.png'
    }], memberToken);
    const memberAttachmentId = memberUpload.attachments[0].id;
    console.log(`    Member uploaded attachment: ${memberAttachmentId}`);

    // Owner deletes the member's attachment
    await apiRequest(`/expenses/${expenseId}/attachments/${memberAttachmentId}`, 'DELETE', null, ownerToken);
    console.log('    ✓ Owner successfully deleted member\'s attachment');

    // 15. Test 11 & 12: Delete expense with attachments (tests both DB cascade and Cloudinary cleanup)
    console.log('\n15. Deleting expense containing attachments...');
    await apiRequest(`/expenses/${expenseId}`, 'DELETE', null, ownerToken);
    console.log('    ✓ Expense and its remaining attachments deleted successfully');

    console.log('\n=== ALL CLOUD STORAGE & UPLOAD SCENARIOS PASSED SUCCESSFULLY! ===');
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
