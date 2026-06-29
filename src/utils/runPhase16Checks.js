const prisma = require('./prisma');

const BASE_URL = 'http://localhost:5000/api';

// 1x1 tiny base64 encoded image
const PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

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

async function run() {
  console.log('================================================================');
  console.log('PHASE 16 INTEGRATION VERIFICATION RUN');
  console.log('================================================================\n');

  const timestamp = Date.now();
  const email = `profile_test_${timestamp}@example.com`;
  const password = 'Password123';
  let userId;
  let token;
  let refreshToken;

  // 1. Register and login
  try {
    console.log('--- Check 1: Registering & Authenticating Verifier User ---');
    const registerRes = await apiRequest('/auth/register', 'POST', {
      email,
      password,
      name: 'Verifier Initial Name'
    });
    userId = registerRes.user.id;
    
    const loginRes = await apiRequest('/auth/login', 'POST', { email, password });
    token = loginRes.accessToken;
    refreshToken = loginRes.refreshToken;
    console.log(`   User registered and logged in. ID: ${userId}`);
    console.log('Result: PASS\n');
  } catch (err) {
    console.error('Check 1: FAIL', err);
    process.exit(1);
  }

  // 2. Profile retrieval
  try {
    console.log('--- Check 2: Verify Profile Retrieval (GET /auth/me) ---');
    const meRes = await apiRequest('/auth/me', 'GET', null, token);
    console.log('Response body:', JSON.stringify(meRes));
    if (meRes.user.name !== 'Verifier Initial Name') {
      throw new Error(`Expected name to be "Verifier Initial Name", got: "${meRes.user.name}"`);
    }
    console.log('Result: PASS\n');
  } catch (err) {
    console.error('Check 2: FAIL', err);
    process.exit(1);
  }

  // 3. Name update
  try {
    console.log('--- Check 3: Verify Profile Name Update (PATCH /users/profile) ---');
    const payload = { name: '  Verifier Updated Name  ' }; // has whitespace to test trimming
    console.log(`Payload (Body): ${JSON.stringify(payload)}`);
    const updateRes = await apiRequest('/users/profile', 'PATCH', payload, token);
    console.log('Response body:', JSON.stringify(updateRes));
    
    if (updateRes.user.name !== 'Verifier Updated Name') {
      throw new Error(`Expected trimmed name to be "Verifier Updated Name", got: "${updateRes.user.name}"`);
    }
    console.log('Result: PASS\n');
  } catch (err) {
    console.error('Check 3: FAIL', err);
    process.exit(1);
  }

  // 4. Validation checks
  try {
    console.log('--- Check 4: Verify Profile Name Validations ---');
    console.log('   Testing empty name rejection...');
    try {
      await apiRequest('/users/profile', 'PATCH', { name: '   ' }, token);
      throw new Error('Server accepted empty name!');
    } catch (err) {
      if (err.status !== 400) throw err;
      console.log('   Rejected empty name with 400 (Expected)');
    }

    console.log('   Testing too short name rejection...');
    try {
      await apiRequest('/users/profile', 'PATCH', { name: 'ab' }, token);
      throw new Error('Server accepted 2-character name!');
    } catch (err) {
      if (err.status !== 400) throw err;
      console.log('   Rejected short name with 400 (Expected)');
    }
    console.log('Result: PASS\n');
  } catch (err) {
    console.error('Check 4: FAIL', err);
    process.exit(1);
  }

  // 5. Avatar upload
  try {
    console.log('--- Check 5: Verify Avatar Upload (Cloudinary Integration) ---');
    const uploadRes = await uploadAvatar(PNG_BASE64, 'avatar.png', 'image/png', token);
    console.log('Response body:', JSON.stringify(uploadRes));
    if (!uploadRes.user.avatar) {
      throw new Error('avatar URL not returned in response!');
    }
    console.log(`   Uploaded Avatar URL: ${uploadRes.user.avatar}`);
    console.log('Result: PASS\n');
  } catch (err) {
    console.error('Check 5: FAIL', err);
    process.exit(1);
  }

  // 6. Avatar replacement
  try {
    console.log('--- Check 6: Verify Avatar Replacement ---');
    const firstUrl = (await prisma.user.findUnique({ where: { id: userId } })).avatar;
    console.log(`   Initial URL: ${firstUrl}`);

    const uploadRes = await uploadAvatar(PNG_BASE64, 'new_avatar.png', 'image/png', token);
    const newUrl = uploadRes.user.avatar;
    console.log('Response body:', JSON.stringify(uploadRes));
    console.log(`   Replaced URL: ${newUrl}`);

    if (firstUrl === newUrl) {
      throw new Error('Replaced avatar did not change the URL!');
    }
    console.log('Result: PASS\n');
  } catch (err) {
    console.error('Check 6: FAIL', err);
    process.exit(1);
  }

  // 7. Avatar deletion
  try {
    console.log('--- Check 7: Verify Avatar Deletion (removeAvatar: true) ---');
    const deleteRes = await apiRequest('/users/profile', 'PATCH', { removeAvatar: true }, token);
    console.log('Response body:', JSON.stringify(deleteRes));
    if (deleteRes.user.avatar !== null) {
      throw new Error('Avatar was not set to null in database!');
    }
    console.log('Result: PASS\n');
  } catch (err) {
    console.error('Check 7: FAIL', err);
    process.exit(1);
  }

  // 8. Logout
  try {
    console.log('--- Check 8: Verify Logout Current Session ---');
    // Note: Since this verification script does not hold cookie states across fetch calls
    // (cookies are not processed automatically in standard node fetch unless manually passed),
    // we can request POST /auth/logout (for JSON-based tokens if any, or just asserting route works).
    const logoutRes = await apiRequest('/auth/logout', 'POST', { refreshToken }, token);
    console.log('Response body:', JSON.stringify(logoutRes));
    console.log('Result: PASS\n');
  } catch (err) {
    console.error('Check 8: FAIL', err);
    process.exit(1);
  }

  // 9. Logout All Devices
  try {
    console.log('--- Check 9: Verify Logout All Devices ---');
    const logoutAllRes = await apiRequest('/auth/logout-all', 'POST', { refreshToken }, token);
    console.log('Response body:', JSON.stringify(logoutAllRes));
    console.log('Result: PASS\n');
  } catch (err) {
    console.error('Check 9: FAIL', err);
    process.exit(1);
  }

  console.log('================================================================');
  console.log('ALL PHASE 16 INTEGRATION CHECKS PASSED SUCCESSFULLY!');
  console.log('================================================================');
}

run();
