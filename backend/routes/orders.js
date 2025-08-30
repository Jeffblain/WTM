const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../config/database');
const router = express.Router();

// GET all orders
router.get('/', async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM orders ORDER BY created_at DESC');
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching orders:', error);
    res.status(500).json({ error: 'Failed to fetch orders' });
  }
});

// POST new order
router.post('/', async (req, res) => {
  try {
    const { groupName, guestNames, selections, wineryId } = req.body;
    const orderId = uuidv4();
    
    const query = `
      INSERT INTO orders (id, group_name, guest_names, selections, winery_id, status, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, NOW())
      RETURNING *
    `;
    
    const values = [
      orderId,
      groupName,
      JSON.stringify(guestNames),
      JSON.stringify(selections),
      wineryId || 1, // Default winery
      'active'
    ];
    
    const result = await db.query(query, values);
    
    // Emit real-time update to all connected clients
    req.app.get('io').emit('newOrder', result.rows[0]);
    
    res.status(201).json({
      success: true,
      order: result.rows[0]
    });
  } catch (error) {
    console.error('Error creating order:', error);
    res.status(500).json({ error: 'Failed to create order' });
  }
});

// PUT update order status
router.put('/:orderId/status', async (req, res) => {
  try {
    const { orderId } = req.params;
    const { guestId, wineId, status } = req.body;
    
    // Get current order
    const orderResult = await db.query('SELECT * FROM orders WHERE id = $1', [orderId]);
    if (orderResult.rows.length === 0) {
      return res.status(404).json({ error: 'Order not found' });
    }
    
    const order = orderResult.rows[0];
    const selections = JSON.parse(order.selections);
    
    // Update the specific wine status for the guest
    if (selections[guestId] && selections[guestId][wineId]) {
      selections[guestId][wineId].status = status;
    }
    
    // Update database
    const updateQuery = 'UPDATE orders SET selections = $1, updated_at = NOW() WHERE id = $2 RETURNING *';
    const updateResult = await db.query(updateQuery, [JSON.stringify(selections), orderId]);
    
    // Emit real-time update
    req.app.get('io').emit('orderUpdate', updateResult.rows[0]);
    
    res.json(updateResult.rows[0]);
  } catch (error) {
    console.error('Error updating order status:', error);
    res.status(500).json({ error: 'Failed to update order status' });
  }
});

// GET specific order
router.get('/:orderId', async (req, res) => {
  try {
    const { orderId } = req.params;
    const result = await db.query('SELECT * FROM orders WHERE id = $1', [orderId]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Order not found' });
    }
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error fetching order:', error);
    res.status(500).json({ error: 'Failed to fetch order' });
  }
});

module.exports = router;