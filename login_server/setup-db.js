const { Pool } = require('pg');
const config = require('./config');
const fs = require('fs');
const path = require('path');

async function setupDatabase() {
  const pool = new Pool(config.database);
  
  try {
    console.log('Setting up PostgreSQL database...');
    
    // Read the setup SQL file
    const setupSQL = fs.readFileSync(path.join(__dirname, '..', 'setup.sq.sql'), 'utf8');
    
    // Execute the setup SQL
    const client = await pool.connect();
    await client.query(setupSQL);
    client.release();
    
    console.log('✅ Database setup completed successfully!');
    console.log('✅ sensory_reports table created with sample data');
    console.log('✅ Indexes and triggers created');
    
  } catch (error) {
    console.error('❌ Database setup failed:', error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

setupDatabase();
