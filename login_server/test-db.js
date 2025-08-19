const { connectDB } = require('./db');

async function testConnection() {
  try {
    console.log('Testing PostgreSQL connection...');
    const pool = await connectDB();
    
    // Test a simple query
    const client = await pool.connect();
    const result = await client.query('SELECT NOW() as current_time');
    client.release();
    
    console.log('✅ Database connection successful!');
    console.log('Current time from database:', result.rows[0].current_time);
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Database connection failed:', error.message);
    process.exit(1);
  }
}

testConnection();
