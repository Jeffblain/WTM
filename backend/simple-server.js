const http = require('http');
const url = require('url');
const querystring = require('querystring');

// In-memory storage (replace with database later)
let orders = [];
let groups = [];

// CORS headers
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
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

const server = http.createServer(async (req, res) => {
  // Handle CORS
  if (handleCors(req, res)) return;
  
  const parsedUrl = url.parse(req.url, true);
  const path = parsedUrl.pathname;
  const method = req.method;
  
  res.writeHead(200, corsHeaders);
  
  try {
    // Routes
    if (path === '/health' && method === 'GET') {
      res.end(JSON.stringify({ 
        status: 'healthy', 
        timestamp: new Date().toISOString(),
        orders: orders.length,
        groups: groups.length
      }));
      
    } else if (path === '/api/orders' && method === 'POST') {
      const body = await parseBody(req);
      const order = {
        id: Date.now().toString(),
        groupName: body.groupName,
        guestNames: body.guestNames,
        selections: body.selections,
        timestamp: new Date().toISOString(),
        status: 'active'
      };
      orders.push(order);
      
      // Add to groups if not exists
      if (!groups.find(g => g.name === body.groupName)) {
        groups.push({
          name: body.groupName,
          timestamp: new Date().toLocaleString(),
          status: 'active',
          guestCount: Object.keys(body.guestNames || {}).length
        });
      }
      
      res.end(JSON.stringify({ success: true, orderId: order.id }));
      
    } else if (path === '/api/groups' && method === 'GET') {
      res.end(JSON.stringify(groups));
      
    } else if (path.startsWith('/api/orders/') && method === 'GET') {
      const orderId = path.split('/')[3];
      const order = orders.find(o => o.id === orderId);
      res.end(JSON.stringify(order || { error: 'Order not found' }));
      
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
      
    } else if (path === '/' && method === 'GET') {
      res.end(JSON.stringify({
        message: 'Wine Tasting Management API',
        version: '1.0.0',
        endpoints: [
          'GET /health',
          'POST /api/orders',
          'GET /api/groups',
          'GET /api/orders/:id',
          'GET /api/wines'
        ]
      }));
      
    } else {
      res.writeHead(404, corsHeaders);
      res.end(JSON.stringify({ error: 'Route not found' }));
    }
    
  } catch (error) {
    console.error('Server error:', error);
    res.writeHead(500, corsHeaders);
    res.end(JSON.stringify({ error: 'Internal server error' }));
  }
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`🍷 Wine Tasting API running on port ${PORT}`);
  console.log(`🚀 No dependencies needed - using Node.js built-ins only!`);
  console.log(`📡 Test: http://localhost:${PORT}/health`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('🛑 Server shutting down...');
  server.close(() => {
    console.log('✅ Server closed');
    process.exit(0);
  });
});