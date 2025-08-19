const express = require('express');
const cors = require('cors');
const { connectDB } = require('./db');
const userRoutes = require('./User');

const app = express();
const port = 3001; // Use different port

app.use(cors());
app.use(express.json());

async function startDebugServer() {
    try {
        console.log('🔧 Starting debug server...');
        
        // Connect to database
        await connectDB();
        console.log('✅ Database connected');
        
        // Set up user routes
        app.use('/api/users', userRoutes);
        console.log('✅ User routes set up');
        
        // Simple test route
        app.get('/test', (req, res) => {
            res.json({ message: 'Debug server is working' });
        });
        
        app.listen(port, () => {
            console.log(`========================================`);
            console.log(`🔧 Debug server running on port ${port}`);
            console.log(`📊 Test endpoints:`);
            console.log(`   GET  /test - Basic test`);
            console.log(`   POST /api/users/signup - User signup`);
            console.log(`   POST /api/users/signin - User signin`);
            console.log(`========================================`);
        });
        
    } catch (error) {
        console.error('❌ Debug server failed:', error);
        process.exit(1);
    }
}

startDebugServer();
