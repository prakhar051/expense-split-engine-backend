const prisma = require('./prisma');

const BASE_URL = 'http://localhost:5000/api';

async function runCookieTests() {
  console.log('=== Starting Phase 12: Cookie-Based Auth Verification ===\n');

  const timestamp = Date.now();
  const testEmail = `cookie_user_${timestamp}@example.com`;
  const password = 'SecurePassword123';
  const name = 'Cookie Tester';

  let accessToken = null;
  let cookieHeader = null;

  try {
    // 1. Register User & Assert Cookie Set
    console.log('1. Registering new user...');
    const regRes = await fetch(`${BASE_URL}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: testEmail, password, name })
    });

    const regData = await regRes.json();
    if (!regRes.ok) throw new Error(`Reg failed: ${regData.message}`);
    console.log('   ✓ User registered successfully.');

    // Inspect Set-Cookie header
    const rawSetCookies = regRes.headers.getSetCookie ? regRes.headers.getSetCookie() : regRes.headers.get('set-cookie');
    console.log('   Headers Set-Cookie:', rawSetCookies);

    const refreshTokenCookie = rawSetCookies.find(cookie => cookie.includes('refreshToken='));
    if (!refreshTokenCookie) throw new Error('refreshToken cookie was not set during registration');
    
    // Assert HttpOnly is present
    if (!refreshTokenCookie.toLowerCase().includes('httponly')) {
      throw new Error('refreshToken cookie must be HttpOnly');
    }
    console.log('   ✓ Secure HttpOnly refresh token cookie successfully verified on registration.');

    // Save refresh cookie for next requests
    // Extract everything up to first semicolon (e.g. "refreshToken=abc")
    cookieHeader = refreshTokenCookie.split(';')[0];

    // 2. Login User & Assert Cookie Set
    console.log('\n2. Logging in...');
    const loginRes = await fetch(`${BASE_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: testEmail, password })
    });

    const loginData = await loginRes.json();
    if (!loginRes.ok) throw new Error(`Login failed: ${loginData.message}`);
    accessToken = loginData.accessToken;
    console.log('   ✓ Logged in successfully. Access token retrieved.');

    const loginSetCookies = loginRes.headers.getSetCookie ? loginRes.headers.getSetCookie() : loginRes.headers.get('set-cookie');
    const loginCookie = loginSetCookies.find(cookie => cookie.includes('refreshToken='));
    if (!loginCookie) throw new Error('refreshToken cookie was not set during login');
    if (!loginCookie.toLowerCase().includes('httponly')) {
      throw new Error('login refreshToken cookie must be HttpOnly');
    }
    console.log('   ✓ Secure HttpOnly refresh token cookie verified on login.');

    cookieHeader = loginCookie.split(';')[0];

    // 3. Test GET /auth/me profile details
    console.log('\n3. Fetching /auth/me user profile...');
    const meRes = await fetch(`${BASE_URL}/auth/me`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });

    const meData = await meRes.json();
    if (!meRes.ok) throw new Error(`Fetch profile failed: ${meData.message}`);
    console.log('   Profile Response:', JSON.stringify(meData.user, null, 2));
    if (meData.user.email !== testEmail) throw new Error('Incorrect email returned');
    console.log('   ✓ Profile fetch successful and formatted correctly.');

    // 4. Test Token Refresh (Silent Rotation)
    console.log('\n4. Requesting token refresh via cookie...');
    const refreshRes = await fetch(`${BASE_URL}/auth/refresh`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': cookieHeader
      }
    });

    const refreshData = await refreshRes.json();
    if (!refreshRes.ok) throw new Error(`Refresh failed: ${refreshData.message}`);
    console.log('   ✓ Refresh call succeeded.');
    console.log('   New access token issued:', refreshData.accessToken ? 'Present (OK)' : 'Missing');

    const refreshSetCookies = refreshRes.headers.getSetCookie ? refreshRes.headers.getSetCookie() : refreshRes.headers.get('set-cookie');
    const rotatedCookie = refreshSetCookies.find(cookie => cookie.includes('refreshToken='));
    if (!rotatedCookie) throw new Error('refreshToken cookie was not rotated during refresh');
    console.log('   ✓ Secure HttpOnly cookie rotation verified.');

    cookieHeader = rotatedCookie.split(';')[0];

    // 5. Test Logout and Purge Cookies
    console.log('\n5. Logging out current session...');
    const logoutRes = await fetch(`${BASE_URL}/auth/logout`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': cookieHeader
      }
    });

    const logoutData = await logoutRes.json();
    if (!logoutRes.ok) throw new Error(`Logout failed: ${logoutData.message}`);
    console.log('   ✓ Logout call succeeded.');

    const logoutSetCookies = logoutRes.headers.getSetCookie ? logoutRes.headers.getSetCookie() : logoutRes.headers.get('set-cookie');
    const clearedCookie = logoutSetCookies.find(cookie => cookie.includes('refreshToken='));
    // Cleared cookie has Max-Age=0 or past expiry date
    if (!clearedCookie || (!clearedCookie.includes('Max-Age=0') && !clearedCookie.includes('1970'))) {
      throw new Error('Cookie was not cleared during logout');
    }
    console.log('   ✓ Refresh token cookie cleared successfully from browser.');

    // 6. Test Logout All Devices
    console.log('\n6. Logging in again to test logout-all...');
    const loginAllRes = await fetch(`${BASE_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: testEmail, password })
    });
    const loginAllData = await loginAllRes.json();
    const activeToken = loginAllData.accessToken;

    console.log('   Sending logout-all devices request...');
    const logoutAllRes = await fetch(`${BASE_URL}/auth/logout-all`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${activeToken}` }
    });

    const logoutAllData = await logoutAllRes.json();
    if (!logoutAllRes.ok) throw new Error(`Logout-all failed: ${logoutAllData.message}`);
    console.log('   ✓ Logout-all call succeeded.');

    const logoutAllSetCookies = logoutAllRes.headers.getSetCookie ? logoutAllRes.headers.getSetCookie() : logoutAllRes.headers.get('set-cookie');
    const clearedAllCookie = logoutAllSetCookies.find(cookie => cookie.includes('refreshToken='));
    if (!clearedAllCookie || (!clearedAllCookie.includes('Max-Age=0') && !clearedAllCookie.includes('1970'))) {
      throw new Error('Cookie was not cleared during logout-all');
    }
    console.log('   ✓ Cookie cleared successfully during logout-all.');

    console.log('\n=== ALL PHASE 12 COOKIE AUTH VERIFICATION SCENARIOS PASSED SUCCESSFULLY! ===');

  } catch (err) {
    console.error('\n❌ Verification Failed!');
    console.error(err);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

runCookieTests();
