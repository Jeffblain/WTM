// backend/app.js - PRODUCTION READY SERVER
const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check endpoint (MUST BE FIRST)
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development'
  });
});

// API Routes
const ordersRouter = require('./routes/orders');
const wineriesRouter = require('./routes/wineries');

app.use('/api/orders', ordersRouter);
app.use('/api/wineries', wineriesRouter);

// Serve static files in production
if (process.env.NODE_ENV === 'production') {
  // Serve frontend files
  app.use(express.static(path.join(__dirname, '../frontend')));
  
  // Catch all handler - send back index.html for any route not handled above
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend', 'guest.html'));
  });
} else {
  // Development root route
  app.get('/', (req, res) => {
    res.json({
      message: 'Wine Tasting Management API',
      version: '1.1.0',
      endpoints: [
        'GET /health',
        'GET /api/orders',
        'POST /api/orders',
        'GET /api/orders/group/:groupName',
        'PUT /api/orders/:id/status',
        'GET /api/wineries'
      ]
    });
  });
}

// 404 handler (IMPORTANT - prevents crashes)
app.use((req, res, next) => {
  res.status(404).json({ 
    error: 'Route not found',
    path: req.path,
    method: req.method
  });
});

// Error handling middleware (CRITICAL - prevents server crashes)
app.use((err, req, res, next) => {
  console.error('Server Error:', err);
  
  // Don't leak error details in production
  const isDevelopment = process.env.NODE_ENV !== 'production';
  
  res.status(err.status || 500).json({
    error: isDevelopment ? err.message : 'Internal server error',
    ...(isDevelopment && { stack: err.stack })
  });
});

// Start server
const server = app.listen(PORT, () => {
  console.log(`🍷 Wine Tasting Server running on port ${PORT}`);
  console.log(`📍 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🔗 Health check: http://localhost:${PORT}/health`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('🛑 SIGTERM received, closing server...');
  server.close(() => {
    console.log('✅ Server closed');
    process.exit(0);
  });
});

process.on('uncaughtException', (err) => {
  console.error('💥 Uncaught Exception:', err);
  // Don't exit in production, just log
  if (process.env.NODE_ENV !== 'production') {
    process.exit(1);
  }
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('💥 Unhandled Rejection at:', promise, 'reason:', reason);
  // Don't exit in production, just log
  if (process.env.NODE_ENV !== 'production') {
    process.exit(1);
  }
});

module.exports = app;