const express = require('express');
const db = require('../config/database');
const router = express.Router();

// GET all wineries
router.get('/', async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM wineries ORDER BY name');
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching wineries:', error);
    res.status(500).json({ error: 'Failed to fetch wineries' });
  }
});

// GET wines for a specific winery
router.get('/:wineryId/wines', async (req, res) => {
  try {
    const { wineryId } = req.params;
    const result = await db.query(
      'SELECT * FROM wines WHERE winery_id = $1 ORDER BY category, name',
      [wineryId]
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching wines:', error);
    res.status(500).json({ error: 'Failed to fetch wines' });
  }
});

// GET groups/orders for a specific winery
router.get('/:wineryId/groups', async (req, res) => {
  try {
    const { wineryId } = req.params;
    const result = await db.query(
      `SELECT id, group_name, status, created_at, guest_names, selections 
       FROM orders 
       WHERE winery_id = $1 AND status = 'active'
       ORDER BY created_at DESC`,
      [wineryId]
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching groups:', error);
    res.status(500).json({ error: 'Failed to fetch groups' });
  }
});

module.exports = router;