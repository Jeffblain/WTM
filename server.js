const http = require('http');
const url = require('url');
const { Pool } = require('pg');

// Database connection with Railway environment variables
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || process.env.DATABASE_PUBLIC_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Test database connection
pool.connect()
  .then(() => console.log('✅ Database connected successfully'))
  .catch(err => console.error('❌ Database connection error:', err));

// In-memory storage for backup (in case DB fails)
let orders = [];
let groups = [];

// CORS headers - Fixed for Railway
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
  'Access-Control-Max-Age': '86400',
  'Content-Type': 'application/json'
};

// Handle CORS preflight
function handleCors(req, res) {
  if (req.method === 'OPTIONS') {
    res.writeHead(200, corsHeaders);
    res.end();
    return true;
  }
  return false;
}

// Parse JSON body
function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => body += chunk.toString());
    req.on('end', () => {
      try {
        resolve(JSON.parse(body));
      } catch (e) {
        resolve({});
      }
    });
  });
}

// Initialize database tables
async function initDatabase() {
  try {
    // Create orders table if not exists
    await pool.query(`
      CREATE TABLE IF NOT EXISTS orders (
        id SERIAL PRIMARY KEY,
        group_name VARCHAR(255) NOT NULL,
        guest_names JSONB,
        selections JSONB,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        status VARCHAR(50) DEFAULT 'active'
      )
    `);

    // Create groups table if not exists
    await pool.query(`
      CREATE TABLE IF NOT EXISTS groups (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) UNIQUE NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        status VARCHAR(50) DEFAULT 'active',
        guest_count INTEGER DEFAULT 0
      )
    `);

    console.log('✅ Database tables initialized');
  } catch (error) {
    console.error('❌ Database initialization error:', error);
  }
}

const server = http.createServer(async (req, res) => {
  // Add CORS headers to every response
  Object.entries(corsHeaders).forEach(([key, value]) => {
    res.setHeader(key, value);
  });
  
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }
  
  const parsedUrl = url.parse(req.url, true);
  const path = parsedUrl.pathname;
  const method = req.method;
  
  try {
    // Health check endpoint
    if (path === '/health' && method === 'GET') {
      const dbTest = await pool.query('SELECT NOW()').catch(() => null);
      res.writeHead(200);
      res.end(JSON.stringify({ 
        status: 'healthy', 
        timestamp: new Date().toISOString(),
        database: dbTest ? 'connected' : 'disconnected',
        orders: orders.length,
        groups: groups.length,
        environment: process.env.NODE_ENV || 'development'
      }));
      
    // Submit new order
    } else if (path === '/api/orders' && method === 'POST') {
      const body = await parseBody(req);
      console.log('📥 Received order:', body);
      
      try {
        // Insert into database
        const result = await pool.query(`
          INSERT INTO orders (group_name, guest_names, selections, status) 
          VALUES ($1, $2, $3, 'active') 
          RETURNING id, created_at
        `, [body.groupName, JSON.stringify(body.guestNames), JSON.stringify(body.selections)]);
        
        const orderId = result.rows[0].id;
        const timestamp = result.rows[0].created_at;
        
        // Also add to groups table
        await pool.query(`
          INSERT INTO groups (name, guest_count, status) 
          VALUES ($1, $2, 'active') 
          ON CONFLICT (name) DO UPDATE SET 
            guest_count = $2,
            created_at = CURRENT_TIMESTAMP
        `, [body.groupName, Object.keys(body.guestNames || {}).length]);
        
        console.log('✅ Order saved to database:', orderId);
        res.end(JSON.stringify({ success: true, orderId, timestamp }));
        
      } catch (dbError) {
        console.error('❌ Database error, using memory storage:', dbError);
        
        // Fallback to memory storage
        const order = {
          id: Date.now().toString(),
          groupName: body.groupName,
          guestNames: body.guestNames,
          selections: body.selections,
          timestamp: new Date().toISOString(),
          status: 'active'
        };
        orders.push(order);
        
        if (!groups.find(g => g.name === body.groupName)) {
          groups.push({
            name: body.groupName,
            timestamp: new Date().toLocaleString(),
            status: 'active',
            guestCount: Object.keys(body.guestNames || {}).length
          });
        }
        
        res.end(JSON.stringify({ success: true, orderId: order.id, fallback: true }));
      }
      
    // Get all orders (missing route)
    } else if (path === '/api/orders' && method === 'GET') {
      try {
        const result = await pool.query('SELECT * FROM orders ORDER BY created_at DESC');
        res.end(JSON.stringify(result.rows));
      } catch (dbError) {
        console.error('❌ Database error, using memory storage:', dbError);
        res.end(JSON.stringify(orders));
      }
      
    // Get all groups
    } else if (path === '/api/groups' && method === 'GET') {
      try {
        const result = await pool.query('SELECT * FROM groups ORDER BY created_at DESC');
        res.end(JSON.stringify(result.rows));
      } catch (dbError) {
        console.error('❌ Database error, using memory storage:', dbError);
        res.end(JSON.stringify(groups));
      }
      
    // Get specific order
    } else if (path.startsWith('/api/orders/') && method === 'GET') {
      const orderId = path.split('/')[3];
      
      try {
        const result = await pool.query('SELECT * FROM orders WHERE id = $1', [orderId]);
        if (result.rows.length > 0) {
          res.end(JSON.stringify(result.rows[0]));
        } else {
          res.end(JSON.stringify({ error: 'Order not found' }));
        }
      } catch (dbError) {
        console.error('❌ Database error, using memory storage:', dbError);
        const order = orders.find(o => o.id === orderId);
        res.end(JSON.stringify(order || { error: 'Order not found' }));
      }
      
    // Update wine status
    } else if (path.startsWith('/api/orders/') && path.includes('/status') && method === 'PUT') {
      const pathParts = path.split('/');
      const orderId = pathParts[3];
      const body = await parseBody(req);
      
      try {
        // Get current order
        const orderResult = await pool.query('SELECT * FROM orders WHERE id = $1', [orderId]);
        if (orderResult.rows.length === 0) {
          res.writeHead(404, corsHeaders);
          res.end(JSON.stringify({ error: 'Order not found' }));
          return;
        }
        
        const currentOrder = orderResult.rows[0];
        const selections = currentOrder.selections;
        
        // Update the specific wine status
        if (selections[body.guest] && selections[body.guest][body.wineIndex]) {
          // Fix the double-click issue: normalize status
          const currentStatus = selections[body.guest][body.wineIndex].status;
          const newStatus = (currentStatus === 'non-servi' || currentStatus === 'pending') ? 'servi' : 'non-servi';
          selections[body.guest][body.wineIndex].status = newStatus;
          
          // Update in database
          await pool.query(
            'UPDATE orders SET selections = $1 WHERE id = $2',
            [JSON.stringify(selections), orderId]
          );
          
          console.log(`✅ Status updated: ${body.guest} wine ${body.wineIndex} -> ${newStatus}`);
          res.end(JSON.stringify({ success: true, newStatus }));
        } else {
          res.writeHead(400, corsHeaders);
          res.end(JSON.stringify({ error: 'Invalid wine selection' }));
        }
        
      } catch (dbError) {
        console.error('❌ Status update error:', dbError);
        res.writeHead(500, corsHeaders);
        res.end(JSON.stringify({ error: 'Status update failed' }));
      }
      
    // Get wines list
    } else if (path === '/api/wines' && method === 'GET') {
      const wines = [
        { id: 1, name: "Ze Flying Pig - Cidre", category: "Cidre" },
        { id: 2, name: "Petnat Chardonnay - Bulles", category: "Sparkling" },
        { id: 3, name: "Blanc - Bio", category: "White" },
        { id: 4, name: "Gris de Gris", category: "Rosé" },
        { id: 5, name: "Rosé Plamplemousse", category: "Rosé" },
        { id: 6, name: "Premier Pas - Bio", category: "Red" },
        { id: 7, name: "Hélium", category: "Red" },
        { id: 8, name: "Rouge Bourbon", category: "Red" },
        { id: 9, name: "Rouge Cognac", category: "Red" },
        { id: 10, name: "Le Chat Noir", category: "Fortified" }
      ];
      res.end(JSON.stringify(wines));
      
    // Root endpoint
    } else if (path === '/' && method === 'GET') {
      res.end(JSON.stringify({
        message: '🍷 Wine Tasting Management API',
        version: '1.0.0',
        environment: process.env.NODE_ENV || 'development',
        endpoints: [
          'GET /health',
          'POST /api/orders',
          'GET /api/groups', 
          'GET /api/orders/:id',
          'PUT /api/orders/:id/status',
          'GET /api/wines'
        ]
      }));
      
    } else {
      res.writeHead(404, corsHeaders);
      res.end(JSON.stringify({ error: 'Route not found' }));
    }
    
  } catch (error) {
    console.error('❌ Server error:', error);
    res.writeHead(500, corsHeaders);
    res.end(JSON.stringify({ error: 'Internal server error', details: error.message }));
  }
});

// Railway requires listening on 0.0.0.0, not just localhost
const PORT = process.env.PORT || 3001;
const HOST = '0.0.0.0';

server.listen(PORT, HOST, async () => {
  console.log(`🍷 Wine Tasting API running on http://${HOST}:${PORT}`);
  console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🗄️  Database URL: ${process.env.DATABASE_URL ? 'configured' : 'missing'}`);
  
  // Initialize database tables
  await initDatabase();
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('🛑 Server shutting down...');
  server.close(() => {
    pool.end();
    console.log('✅ Server and database connections closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('🛑 Server shutting down...');
  server.close(() => {
    pool.end();
    console.log('✅ Server and database connections closed');
    process.exit(0);
  });
});