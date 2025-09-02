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

// POST new order - CRASH-PROOF VERSION
router.post('/', async (req, res) => {
  // Prevent double responses
  if (res.headersSent) {
    console.log('Headers already sent, skipping response');
    return;
  }
  
  try {
    const { groupName, guestNames, selections, plateauSelections, wineryId } = req.body;
    const orderId = uuidv4();
    
    console.log('Creating order for:', groupName);
    
    const query = `
      INSERT INTO orders (id, group_name, guest_names, selections, plateau_selections, winery_id, status, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
      RETURNING *
    `;
    
    const values = [
      orderId,
      groupName,
      JSON.stringify(guestNames),
      JSON.stringify(selections),
      JSON.stringify(plateauSelections || []),
      wineryId || 1,
      'active'
    ];
    
    const result = await db.query(query, values);
    
    // ONLY send response once
    return res.status(201).json({
      success: true,
      orderId: result.rows[0].id
    });
    
  } catch (error) {
    console.error('Error creating order:', error);
    if (!res.headersSent) {
      return res.status(500).json({ error: 'Failed to create order' });
    }
  }
});

// GET specific order by order ID
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