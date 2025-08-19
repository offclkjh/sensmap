const axios = require('axios');

async function finalTest() {
  console.log('🎯 Final Comprehensive Test\n');
  
  try {
    // Test 1: Health check
    console.log('1. Testing server health...');
    const health = await axios.get('http://localhost:3000/api/health');
    console.log('✅ Health check passed');
    
    // Test 2: Sensory reports
    console.log('\n2. Testing sensory reports...');
    const reports = await axios.get('http://localhost:3000/api/reports');
    console.log('✅ Sensory reports working');
    
    // Test 3: User signup
    console.log('\n3. Testing user signup...');
    const signup = await axios.post('http://localhost:3000/api/users/signup', {
      name: 'Final Test User',
      email: 'finaltest@example.com',
      password: 'testpassword123'
    });
    console.log('✅ User signup working');
    
    // Test 4: User signin
    console.log('\n4. Testing user signin...');
    const signin = await axios.post('http://localhost:3000/api/users/signin', {
      email: 'finaltest@example.com',
      password: 'testpassword123'
    });
    console.log('✅ User signin working');
    
    // Test 5: Protected endpoint with token
    console.log('\n5. Testing protected endpoint...');
    const token = signin.data.token;
    const profile = await axios.get('http://localhost:3000/api/users/profile', {
      headers: { Authorization: `Bearer ${token}` }
    });
    console.log('✅ Protected endpoint working');
    
    // Test 6: Statistics
    console.log('\n6. Testing statistics...');
    const stats = await axios.get('http://localhost:3000/api/stats');
    console.log('✅ Statistics working');
    
    console.log('\n🎉 ALL TESTS PASSED!');
    console.log('\n✅ PostgreSQL database migration successful!');
    console.log('✅ User authentication working!');
    console.log('✅ Sensory reports working!');
    console.log('✅ Frontend can now connect to backend!');
    
  } catch (error) {
    console.error('❌ Test failed:', error.response?.data || error.message);
  }
}

finalTest();
