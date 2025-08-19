const axios = require('axios');

const BASE_URL = 'http://localhost:3000';

async function testAPI() {
  console.log('🧪 Testing API endpoints...\n');

  try {
    // Test health endpoint
    console.log('1. Testing health endpoint...');
    const healthResponse = await axios.get(`${BASE_URL}/api/health`);
    console.log('✅ Health check passed:', healthResponse.data.message);

    // Test reports endpoint
    console.log('\n2. Testing reports endpoint...');
    const reportsResponse = await axios.get(`${BASE_URL}/api/reports`);
    console.log('✅ Reports endpoint working:', reportsResponse.data.message);

    // Test stats endpoint
    console.log('\n3. Testing stats endpoint...');
    const statsResponse = await axios.get(`${BASE_URL}/api/stats`);
    console.log('✅ Stats endpoint working:', statsResponse.data.message);

    // Test user signup
    console.log('\n4. Testing user signup...');
    const signupResponse = await axios.post(`${BASE_URL}/api/users/signup`, {
      name: 'Test User',
      email: 'test@example.com',
      password: 'testpassword123'
    });
    console.log('✅ User signup working:', signupResponse.data.message);

    // Test user signin
    console.log('\n5. Testing user signin...');
    const signinResponse = await axios.post(`${BASE_URL}/api/users/signin`, {
      email: 'test@example.com',
      password: 'testpassword123'
    });
    console.log('✅ User signin working:', signinResponse.data.message);

    // Test with token
    const token = signinResponse.data.token;
    console.log('\n6. Testing protected endpoint...');
    const profileResponse = await axios.get(`${BASE_URL}/api/users/profile`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    console.log('✅ Protected endpoint working:', profileResponse.data.message);

    console.log('\n🎉 All tests passed! The server is working correctly.');

  } catch (error) {
    console.error('❌ Test failed:', error.response?.data || error.message);
  }
}

// Start the test
testAPI();
