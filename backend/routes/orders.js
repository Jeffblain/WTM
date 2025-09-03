// backend/routes/orders.js - PRODUCTION READY WITH DATABASE
const express = require('express');
const router = express.Router();
const pool = require('../config/database');

// Initialize database table if not exists
async function initializeDatabase() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS orders (
        id SERIAL PRIMARY KEY,
        group_name VARCHAR(255) NOT NULL,
        guest_names JSONB,
        selections JSONB,
        plateau_data JSONB,
        status VARCHAR(50) DEFAULT 'active',
        winery_id INTEGER DEFAULT 1,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    console.log('✅ Orders table ready');
  } catch (error) {
    console.error('Database initialization error:', error);
  }
}

// Initialize on startup
initializeDatabase();

// GET all orders for host dashboard
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM orders WHERE status = $1 ORDER BY created_at DESC',
      ['active']
    );
    
    res.json(result.rows.map(row => ({
      id: row.id,
      groupName: row.group_name,
      guestNames: row.guest_names || {},
      selections: row.selections || {},
      plateauData: row.plateau_data || {},
      status: row.status,
      timestamp: row.created_at
    })));
  } catch (error) {
    console.error('Error fetching orders:', error);
    res.status(500).json({ error: 'Failed to fetch orders' });
  }
});

// GET order by group name (for session recovery)
router.get('/group/:groupName', async (req, res) => {
  try {
    const { groupName } = req.params;
    const result = await pool.query(
      'SELECT * FROM orders WHERE group_name = $1 ORDER BY created_at DESC LIMIT 1',
      [groupName]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Group not found' });
    }
    
    const row = result.rows[0];
    res.json({
      id: row.id,
      groupName: row.group_name,
      guestNames: row.guest_names || {},
      selections: row.selections || {},
      plateauData: row.plateau_data || {},
      status: row.status,
      timestamp: row.created_at
    });
  } catch (error) {
    console.error('Error fetching group:', error);
    res.status(500).json({ error: 'Failed to fetch group' });
  }
});

// POST new order from guest form
router.post('/', async (req, res) => {
  try {
    const { groupName, guestNames, selections, plateauData } = req.body;
    
    // Validate required fields
    if (!groupName) {
      return res.status(400).json({ error: 'Group name is required' });
    }
    
    // Check if group already exists
    const existing = await pool.query(
      'SELECT id FROM orders WHERE group_name = $1',
      [groupName]
    );
    
    if (existing.rows.length > 0) {
      return res.status(400).json({ 
        error: 'Group name already exists. Please choose a different name.' 
      });
    }
    
    // Insert new order
    const result = await pool.query(
      `INSERT INTO orders (group_name, guest_names, selections, plateau_data, status)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [
        groupName,
        JSON.stringify(guestNames || {}),
        JSON.stringify(selections || {}),
        JSON.stringify(plateauData || {}),
        'active'
      ]
    );
    
    const row = result.rows[0];
    res.json({
      success: true,
      orderId: row.id,
      groupName: row.group_name,
      message: 'Order created successfully'
    });
  } catch (error) {
    console.error('Error creating order:', error);
    res.status(500).json({ error: 'Failed to create order' });
  }
});

// PUT update wine status (for host dashboard)
router.put('/:orderId/wine-status', async (req, res) => {
  try {
    const { orderId } = req.params;
    const { guestId, wineIndex, status } = req.body;
    
    // Get current order
    const result = await pool.query(
      'SELECT selections FROM orders WHERE id = $1',
      [orderId]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Order not found' });
    }
    
    // Update the specific wine status
    const selections = result.rows[0].selections;
    if (selections[guestId] && selections[guestId][wineIndex]) {
      selections[guestId][wineIndex].status = status;
      
      // Save back to database
      await pool.query(
        'UPDATE orders SET selections = $1, updated_at = NOW() WHERE id = $2',
        [JSON.stringify(selections), orderId]
      );
      
      res.json({ success: true, message: 'Status updated' });
    } else {
      res.status(400).json({ error: 'Invalid guest or wine index' });
    }
  } catch (error) {
    console.error('Error updating status:', error);
    res.status(500).json({ error: 'Failed to update status' });
  }
});

// PUT update order status (complete/cancel order)
router.put('/:orderId/status', async (req, res) => {
  try {
    const { orderId } = req.params;
    const { status } = req.body;
    
    if (!['active', 'completed', 'cancelled'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }
    
    await pool.query(
      'UPDATE orders SET status = $1, updated_at = NOW() WHERE id = $2',
      [status, orderId]
    );
    
    res.json({ success: true, message: 'Order status updated' });
  } catch (error) {
    console.error('Error updating order status:', error);
    res.status(500).json({ error: 'Failed to update order status' });
  }
});

// DELETE order (for testing/admin)
router.delete('/:orderId', async (req, res) => {
  try {
    const { orderId } = req.params;
    
    // Only allow in development
    if (process.env.NODE_ENV === 'production') {
      return res.status(403).json({ error: 'Delete not allowed in production' });
    }
    
    await pool.query('DELETE FROM orders WHERE id = $1', [orderId]);
    res.json({ success: true, message: 'Order deleted' });
  } catch (error) {
    console.error('Error deleting order:', error);
    res.status(500).json({ error: 'Failed to delete order' });
  }
});

module.exports = router;