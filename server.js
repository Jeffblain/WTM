const http = require('http');
const url = require('url');
const querystring = require('querystring');

// Enhanced in-memory storage using Maps for better performance
let orders = new Map();
let groups = new Map();

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
    // Health check endpoint
    if (path === '/health' && method === 'GET') {
      const health = {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        orders: orders.size,
        groups: groups.size,
        uptime: process.uptime(),
        memory: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + 'MB',
        endpoints: {
          'POST /api/orders': 'Submit wine tasting order',
          'GET /api/groups': 'List all groups',
          'GET /api/orders/:id': 'Get specific order',
          'GET /api/wines': 'Get wine list',
          'GET /api/debug': 'Debug information',
          'GET /health': 'Health check'
        }
      };
      res.end(JSON.stringify(health, null, 2));
      
    // Submit new order
    } else if (path === '/api/orders' && method === 'POST') {
      const body = await parseBody(req);
      
      // Generate consistent IDs
      const orderId = `order_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const groupId = body.groupName.toLowerCase().replace(/[^a-z0-9]/g, '_');
      
      console.log('📝 Creating order:', orderId, 'for group:', body.groupName);
      
      const order = {
        id: orderId,
        groupId: groupId,
        groupName: body.groupName,
        guestNames: body.guestNames || {},
        selections: body.selections || {},
        timestamp: new Date().toISOString(),
        status: 'active',
        submittedAt: new Date().toLocaleString('fr-CA', {
          timeZone: 'America/Montreal',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit'
        })
      };
      
      // Store order
      orders.set(orderId, order);
      
      // Create/update group
      const group = {
        id: groupId,
        name: body.groupName,
        orderId: orderId,
        timestamp: order.submittedAt,
        status: 'active',
        guestCount: Object.keys(body.guestNames || {}).filter(key => body.guestNames[key]).length,
        wineCount: Object.values(body.selections || {}).reduce((total, wines) => total + wines.length, 0)
      };
      
      groups.set(groupId, group);
      
      console.log('✅ Order created successfully');
      console.log('📊 Current orders:', orders.size, 'groups:', groups.size);
      
      res.end(JSON.stringify({ 
        success: true, 
        orderId: orderId,
        groupId: groupId,
        message: 'Order submitted successfully' 
      }));
      
    // Get all groups
    } else if (path === '/api/groups' && method === 'GET') {
      console.log('📋 Fetching groups, count:', groups.size);
      
      const groupsArray = Array.from(groups.values()).map(group => ({
        ...group,
        hasOrder: orders.has(group.orderId),
        // Calculate actual counts from the order data
        guestCount: group.orderId && orders.has(group.orderId) ? 
            Object.keys(orders.get(group.orderId).guestNames || {}).length : 0,
        wineCount: group.orderId && orders.has(group.orderId) ? 
            Object.values(orders.get(group.orderId).selections || {})
                .reduce((total, wines) => total + wines.length, 0) : 0
    }));
      
      console.log('📤 Returning groups:', groupsArray.length);
      res.end(JSON.stringify(groupsArray));
      
    // Get specific order
    } else if (path.startsWith('/api/orders/') && method === 'GET') {
      const pathParts = path.split('/');
      const identifier = pathParts[3];
      
      console.log('🔍 Looking for order with identifier:', identifier);
      console.log('📦 Available orders:', Array.from(orders.keys()));
      
      let order = null;
      
      // Try direct order ID lookup first
      if (orders.has(identifier)) {
        order = orders.get(identifier);
        console.log('✅ Found order by ID:', identifier);
      } else {
        // Try finding by group ID
        const group = groups.get(identifier);
        if (group && group.orderId && orders.has(group.orderId)) {
          order = orders.get(group.orderId);
          console.log('✅ Found order by group ID:', identifier, '-> order:', group.orderId);
        } else {
          // Try finding by group name (fallback)
          for (let [orderId, orderData] of orders) {
            if (orderData.groupName.toLowerCase().replace(/[^a-z0-9]/g, '_') === identifier) {
              order = orderData;
              console.log('✅ Found order by group name match:', identifier);
              break;
            }
          }
        }
      }
      
      if (order) {
        console.log('📤 Returning order for:', order.groupName);
        res.end(JSON.stringify(order));
      } else {
        console.log('❌ Order not found for identifier:', identifier);
        res.writeHead(404, corsHeaders);
        res.end(JSON.stringify({ 
          error: 'Order not found',
          identifier: identifier,
          availableOrders: Array.from(orders.keys()),
          availableGroups: Array.from(groups.keys()),
          debug: true
        }));
      }
      
    // Update order status (for wine status changes)
    } else if (path.startsWith('/api/orders/') && method === 'PUT') {
      const pathParts = path.split('/');
      const identifier = pathParts[3];
      const body = await parseBody(req);
      
      console.log('🔄 Updating order:', identifier, body);
      
      let order = orders.get(identifier);
      if (!order) {
        // Try finding by group ID
        const group = groups.get(identifier);
        if (group && group.orderId) {
          order = orders.get(group.orderId);
        }
      }
      
      if (order) {
        // Update wine status if provided
        if (body.guestId && body.wineIndex !== undefined && body.status) {
          if (order.selections[body.guestId] && order.selections[body.guestId][body.wineIndex]) {
            order.selections[body.guestId][body.wineIndex].status = body.status;
            console.log('✅ Updated wine status');
          }
        }
        
        res.end(JSON.stringify({ success: true, order: order }));
      } else {
        res.writeHead(404, corsHeaders);
        res.end(JSON.stringify({ error: 'Order not found' }));
      }
      
    // Get wine list
    } else if (path === '/api/wines' && method === 'GET') {
      const wines = [
        { id: 1, name: "Ze Flying Pig - Cidre", category: "Cidre", description: "Cidre brut mousseux issu de nos pommes McIntosh" },
        { id: 2, name: "Petnat Chardonnay - Bulles", category: "Bulles", description: "Pétillant naturel 100% Chardonnay, certifié biologique" },
        { id: 3, name: "Blanc - Bio", category: "Blanc", description: "Vin à la robe claire de reflets jaunâtres présentant un nez frais" },
        { id: 4, name: "Gris de Gris", category: "Rosé", description: "Rosé présentant des notes typiques de pamplemousse" },
        { id: 5, name: "Rosé Plamplemousse", category: "Rosé", description: "Robe de couleur pêche, nez présentant des arômes frais" },
        { id: 6, name: "Premier Pas - Bio", category: "Rouge", description: "Vin rouge fermenté en grappes entières" },
        { id: 7, name: "Hélium", category: "Rouge", description: "Chaleureux, équilibré, aromatique et souple" },
        { id: 8, name: "Rouge Bourbon", category: "Rouge", description: "Premier vin rouge élevé en fûts de Bourbon au Québec" },
        { id: 9, name: "Rouge Cognac", category: "Rouge", description: "Premier vin rouge élevé en fûts de Cognac au Québec" },
        { id: 10, name: "Le Chat Noir", category: "Fortifié", description: "Premier vin de paille fortifié au Québec" }
      ];
      res.end(JSON.stringify(wines));
      
    // Debug endpoint
    } else if (path === '/api/debug' && method === 'GET') {
      const debug = {
        timestamp: new Date().toISOString(),
        server: {
          uptime: Math.round(process.uptime()),
          memory: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + 'MB',
          nodeVersion: process.version
        },
        orders: {
          count: orders.size,
          keys: Array.from(orders.keys()),
          sample: orders.size > 0 ? Array.from(orders.values())[0] : null
        },
        groups: {
          count: groups.size,
          keys: Array.from(groups.keys()),
          data: Array.from(groups.values())
        }
      };
      
      console.log('🐛 Debug endpoint called');
      res.end(JSON.stringify(debug, null, 2));
      
    // API root
    } else if (path === '/api' && method === 'GET') {
      res.end(JSON.stringify({
        message: 'Wine Tasting Management API',
        version: '1.0.1',
        status: 'operational',
        endpoints: [
          'GET /health - Health check',
          'POST /api/orders - Submit order',
          'GET /api/groups - List groups',
          'GET /api/orders/:id - Get order',
          'PUT /api/orders/:id - Update order',
          'GET /api/wines - Wine list',
          'GET /api/debug - Debug info'
        ]
      }));
      
    // Root endpoint
    } else if (path === '/' && method === 'GET') {
      res.end(JSON.stringify({
        message: '🍷 Wine Tasting Management System',
        version: '1.0.1',
        status: 'online',
        time: new Date().toLocaleString('fr-CA', { timeZone: 'America/Montreal' }),
        orders: orders.size,
        groups: groups.size
      }));
      
    } else {
      res.writeHead(404, corsHeaders);
      res.end(JSON.stringify({ 
        error: 'Route not found',
        path: path,
        method: method,
        availableEndpoints: ['/health', '/api', '/api/orders', '/api/groups', '/api/wines', '/api/debug']
      }));
    }
    
  } catch (error) {
    console.error('💥 Server error:', error);
    res.writeHead(500, corsHeaders);
    res.end(JSON.stringify({ 
      error: 'Internal server error',
      message: error.message,
      timestamp: new Date().toISOString()
    }));
  }
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`🍷 Wine Tasting Management API`);
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📡 Health check: http://localhost:${PORT}/health`);
  console.log(`🐛 Debug info: http://localhost:${PORT}/api/debug`);
  console.log(`⏰ Started: ${new Date().toLocaleString('fr-CA', { timeZone: 'America/Montreal' })}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('🛑 Received SIGTERM, shutting down gracefully...');
  server.close(() => {
    console.log('✅ Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('🛑 Received SIGINT, shutting down gracefully...');
  server.close(() => {
    console.log('✅ Server closed');
    process.exit(0);
  });
});