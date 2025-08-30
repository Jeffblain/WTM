require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const http = require('http');
const socketIo = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST", "PUT", "DELETE"]
    }
});

// Middleware
app.use(cors());
app.use(express.json());

// Database configuration
const pool = new Pool({
    host: process.env.PGHOST || 'localhost',
    port: process.env.PGPORT || 5432,
    database: process.env.PGDATABASE || 'railway',
    user: process.env.PGUSER || 'postgres',
    password: process.env.PGPASSWORD || 'your_password',
});

// Test database connection
pool.connect((err, client, release) => {
    if (err) {
        console.error('❌ Database connection error:', err);
    } else {
        console.log('✅ Connected to PostgreSQL database');
        release();
    }
});

// Socket.io connection handling
io.on('connection', (socket) => {
    console.log('📡 Client connected via Socket.io');
    
    socket.on('disconnect', () => {
        console.log('📡 Client disconnected');
    });
});

// 🏥 Health check endpoint
app.get('/health', (req, res) => {
    res.json({ 
        status: 'healthy', 
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV || 'development'
    });
});

// 🏪 Get all wineries
app.get('/api/wineries', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM wineries ORDER BY name');
        res.json(result.rows);
    } catch (error) {
        console.error('❌ Error fetching wineries:', error);
        res.status(500).json({ error: 'Failed to fetch wineries' });
    }
});

// 🍷 Get wines for a winery
app.get('/api/wineries/:wineryId/wines', async (req, res) => {
    try {
        const { wineryId } = req.params;
        const result = await pool.query(
            'SELECT * FROM wines WHERE winery_id = $1 ORDER BY name',
            [wineryId]
        );
        res.json(result.rows);
    } catch (error) {
        console.error('❌ Error fetching wines:', error);
        res.status(500).json({ error: 'Failed to fetch wines' });
    }
});

// 📋 Get all orders
app.get('/api/orders', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT 
                o.*,
                w.name as winery_name
            FROM orders o
            JOIN wineries w ON o.winery_id = w.id
            ORDER BY o.created_at DESC
        `);
        
        res.json(result.rows);
    } catch (error) {
        console.error('❌ Error fetching orders:', error);
        res.status(500).json({ error: 'Failed to fetch orders' });
    }
});

// 📄 Get specific order by ID
app.get('/api/orders/:orderId', async (req, res) => {
    try {
        const { orderId } = req.params;
        const result = await pool.query(`
            SELECT 
                o.*,
                w.name as winery_name
            FROM orders o
            JOIN wineries w ON o.winery_id = w.id
            WHERE o.id = $1
        `, [orderId]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Order not found' });
        }
        
        res.json(result.rows[0]);
    } catch (error) {
        console.error('❌ Error fetching order:', error);
        res.status(500).json({ error: 'Failed to fetch order' });
    }
});

// 🚀 CREATE ORDER - FIXED VERSION
app.post('/api/orders', async (req, res) => {
    try {
        const { wineryId, groupName, guestNames, selections, tableNumber, notes } = req.body;
        
        console.log('📥 Received order submission:', {
            wineryId, 
            groupName, 
            guestCount: Object.keys(guestNames || {}).length,
            selectionsCount: Object.keys(selections || {}).length
        });
        
        // Validate required fields
        if (!wineryId || !groupName) {
            return res.status(400).json({ 
                error: 'Missing required fields: wineryId and groupName are required' 
            });
        }
        
        // Insert order into database
        const result = await pool.query(`
            INSERT INTO orders (
                winery_id, 
                group_name, 
                guest_names, 
                selections, 
                table_number, 
                notes,
                status,
                created_at,
                updated_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
            RETURNING *
        `, [
            wineryId,
            groupName,
            JSON.stringify(guestNames),
            JSON.stringify(selections),
            tableNumber,
            notes,
            'active'
        ]);
        
        const newOrder = result.rows[0];
        console.log('✅ Order created successfully:', newOrder.id);
        
        // 📡 Emit Socket.io notification to all connected hosts
        io.emit('orderUpdate', {
            type: 'new_order',
            order: newOrder,
            message: `Nouvelle commande: ${groupName}`
        });
        
        // Return success response in JSON format
        res.status(201).json({
            success: true,
            message: 'Order submitted successfully',
            orderId: newOrder.id,
            order: newOrder
        });
        
    } catch (error) {
        console.error('❌ Error creating order:', error);
        res.status(500).json({ 
            error: 'Failed to create order',
            details: error.message 
        });
    }
});

// 🔄 UPDATE ORDER STATUS - THE MISSING ENDPOINT!
app.put('/api/orders/:orderId/status', async (req, res) => {
    try {
        const { orderId } = req.params;
        const { guest, itemIndex, newStatus } = req.body;
        
        console.log('📥 Status update request:', { orderId, guest, itemIndex, newStatus });
        
        // Validate input
        if (!guest || itemIndex === undefined || !newStatus) {
            return res.status(400).json({ 
                error: 'Missing required fields: guest, itemIndex, and newStatus are required' 
            });
        }
        
        // Get current order
        const orderResult = await pool.query('SELECT * FROM orders WHERE id = $1', [orderId]);
        
        if (orderResult.rows.length === 0) {
            return res.status(404).json({ error: 'Order not found' });
        }
        
        const order = orderResult.rows[0];
        let selections = typeof order.selections === 'string' 
            ? JSON.parse(order.selections) 
            : order.selections;
        
        // Update the specific wine status
        if (selections[guest] && selections[guest][itemIndex]) {
            const oldStatus = selections[guest][itemIndex].status;
            selections[guest][itemIndex].status = newStatus;
            
            console.log(`🔄 Updated status: Guest ${guest}, Item ${itemIndex}: ${oldStatus} → ${newStatus}`);
        } else {
            return res.status(400).json({ 
                error: `Invalid guest (${guest}) or itemIndex (${itemIndex})` 
            });
        }
        
        // Update database
        const updateResult = await pool.query(`
            UPDATE orders 
            SET selections = $1, updated_at = NOW()
            WHERE id = $2
            RETURNING *
        `, [JSON.stringify(selections), orderId]);
        
        const updatedOrder = updateResult.rows[0];
        
        // 📡 Emit Socket.io notification
        io.emit('orderUpdate', {
            type: 'status_update',
            orderId: orderId,
            guest: guest,
            itemIndex: itemIndex,
            newStatus: newStatus,
            order: updatedOrder
        });
        
        console.log('✅ Status updated successfully');
        
        // Return success response
        res.json({
            success: true,
            message: 'Status updated successfully',
            order: updatedOrder
        });
        
    } catch (error) {
        console.error('❌ Error updating order status:', error);
        res.status(500).json({ 
            error: 'Failed to update order status',
            details: error.message 
        });
    }
});

// 🗑️ Delete order (optional - for testing)
app.delete('/api/orders/:orderId', async (req, res) => {
    try {
        const { orderId } = req.params;
        
        const result = await pool.query('DELETE FROM orders WHERE id = $1 RETURNING *', [orderId]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Order not found' });
        }
        
        // Notify via Socket.io
        io.emit('orderUpdate', {
            type: 'order_deleted',
            orderId: orderId
        });
        
        res.json({ 
            success: true, 
            message: 'Order deleted successfully' 
        });
        
    } catch (error) {
        console.error('❌ Error deleting order:', error);
        res.status(500).json({ error: 'Failed to delete order' });
    }
});

// 🚫 Handle 404 for unknown routes
app.use('*', (req, res) => {
    res.status(404).json({ 
        error: 'Route not found',
        path: req.originalUrl,
        method: req.method
    });
});

// Start server
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
    console.log('🍷 Wine Tasting API running on port', PORT);
    console.log('🚀 Environment:', process.env.NODE_ENV || 'development');
    console.log('📡 Socket.io server ready');
    console.log('🔗 Available endpoints:');
    console.log('  GET  /health');
    console.log('  GET  /api/wineries');
    console.log('  GET  /api/wineries/:id/wines');
    console.log('  GET  /api/orders');
    console.log('  POST /api/orders');
    console.log('  GET  /api/orders/:id');
    console.log('  PUT  /api/orders/:id/status');
    console.log('  DEL  /api/orders/:id');
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('🛑 Server shutting down...');
    server.close(() => {
        pool.end();
        console.log('✅ Server closed');
        process.exit(0);
    });
});