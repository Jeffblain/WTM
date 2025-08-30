const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Test connection
pool.on('connect', () => {
  console.log('✅ Connected to PostgreSQL database');
});

pool.on('error', (err) => {
  console.error('❌ Database connection error:', err);
});

// Initialize database tables
async function initialize() {
  try {
    // Create wineries table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS wineries (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        slug VARCHAR(255) UNIQUE NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Create wines table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS wines (
        id SERIAL PRIMARY KEY,
        winery_id INTEGER REFERENCES wineries(id),
        name VARCHAR(255) NOT NULL,
        description TEXT,
        category VARCHAR(100),
        price DECIMAL(10,2),
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Create orders table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS orders (
        id UUID PRIMARY KEY,
        winery_id INTEGER REFERENCES wineries(id),
        group_name VARCHAR(255) NOT NULL,
        guest_names JSONB,
        selections JSONB,
        status VARCHAR(50) DEFAULT 'active',
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Insert default winery and wines if not exist
    const wineryCheck = await pool.query('SELECT id FROM wineries WHERE slug = $1', ['vignoble-le-chat-botte']);
    
    if (wineryCheck.rows.length === 0) {
      const wineryResult = await pool.query(
        'INSERT INTO wineries (name, slug) VALUES ($1, $2) RETURNING id',
        ['Vignoble le Chat Botté', 'vignoble-le-chat-botte']
      );
      
      const wineryId = wineryResult.rows[0].id;
      
      // Insert wines
      const wines = [
        { name: "Ze Flying Pig - Cidre", description: "Cidre brut mousseux issu de nos pommes McIntosh", category: "Cidre" },
        { name: "Petnat Chardonnay - Bulles", description: "Pétillant naturel 100% Chardonnay, certifié biologique", category: "Sparkling" },
        { name: "Blanc - Bio", description: "Vin à la robe claire de reflets jaunâtres présentant un nez frais et minéral", category: "White" },
        { name: "Gris de Gris", description: "Rosé présentant des notes typiques de pamplemousse et de zeste d'agrumes", category: "Rosé" },
        { name: "Rosé Plamplemousse", description: "Robe de couleur pêche, nez présentant des arômes frais de pamplemousse rose", category: "Rosé" },
        { name: "Premier Pas - Bio", description: "Vin rouge fermenté en grappes entières", category: "Red" },
        { name: "Hélium", description: "Chaleureux, équilibré, aromatique et souple", category: "Red" },
        { name: "Rouge Bourbon", description: "Premier vin rouge élevé en fûts de Bourbon au Québec", category: "Red" },
        { name: "Rouge Cognac", description: "Premier vin rouge élevé en fûts de Cognac au Québec", category: "Red" },
        { name: "Le Chat Noir", description: "Premier vin de paille fortifié au Québec", category: "Fortified" }
      ];
      
      for (const wine of wines) {
        await pool.query(
          'INSERT INTO wines (winery_id, name, description, category) VALUES ($1, $2, $3, $4)',
          [wineryId, wine.name, wine.description, wine.category]
        );
      }
      
      console.log('✅ Default winery and wines created');
    }

    console.log('✅ Database initialized successfully');
  } catch (error) {
    console.error('❌ Database initialization failed:', error);
    throw error;
  }
}

module.exports = {
  query: (text, params) => pool.query(text, params),
  pool,
  initialize
};