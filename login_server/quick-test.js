const axios = require('axios');

async function quickTest() {
  console.log('🧪 Quick API Test\n');
  
  try {
    // Test health endpoint
    const health = await axios.get('http://localhost:3000/api/health');
    console.log('✅ Health check:', health.data.message);
    
    // Test user signup
    const signup = await axios.post('http://localhost:3000/api/users/signup', {
      name: 'Test User',
      email: 'test@example.com',
      password: 'testpassword123'
    });
    console.log('✅ User signup:', signup.data.message);
    
    // Test user signin
    const signin = await axios.post('http://localhost:3000/api/users/signin', {
      email: 'test@example.com',
      password: 'testpassword123'
    });
    console.log('✅ User signin:', signin.data.message);
    
    // Test reports endpoint
    const reports = await axios.get('http://localhost:3000/api/reports');
    console.log('✅ Reports endpoint:', reports.data.message);
    
    console.log('\n🎉 All tests passed! Both databases are working correctly.');
    
  } catch (error) {
    console.error('❌ Test failed:', error.response?.data || error.message);
  }
}

quickTest();
