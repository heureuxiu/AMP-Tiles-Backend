const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');
const Product = require('../models/Product');
const User = require('../models/User');

// Load env vars from server root
dotenv.config({ path: path.join(__dirname, '../../.env') });

const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('MongoDB Connected');
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
};

const sampleProducts = [
  // Royal Series
  { name: 'Amaze Grey Polished', sku: 'RYL-AMZ-GRY-POL', category: 'Royal Series', finish: 'Polished', price: 45.99, stock: 245 },
  { name: 'Amaze Luxury Matt', sku: 'RYL-AMZ-LUX-MAT', category: 'Royal Series', finish: 'Matt', price: 42.99, stock: 156 },
  { name: 'Royal White Gloss', sku: 'RYL-WHT-GLS', category: 'Royal Series', finish: 'Gloss', price: 48.99, stock: 89 },
  
  // Sivno Series
  { name: 'Sivno Grey Matt', sku: 'SIV-GRY-MAT', category: 'Sivno Series', finish: 'Matt', price: 39.99, stock: 134 },
  { name: 'Sivno Beige Polished', sku: 'SIV-BEG-POL', category: 'Sivno Series', finish: 'Polished', price: 44.99, stock: 67 },
  
  // Tile
  { name: 'Classic White Tile', sku: 'TIL-CLS-WHT', category: 'Tile', finish: 'Matt', price: 29.99, stock: 456 },
  { name: 'Modern Grey Tile', sku: 'TIL-MOD-GRY', category: 'Tile', finish: 'Gloss', price: 32.99, stock: 234 },
  
  // Artic Series
  { name: 'Artic Apricot Matt', sku: 'ART-APR-MAT', category: 'Artic Series', finish: 'Matt', price: 41.99, stock: 89 },
  { name: 'Artic Cloud Matt', sku: 'ART-CLD-MAT', category: 'Artic Series', finish: 'Matt', price: 41.99, stock: 23 },
  { name: 'Artic Snow Polished', sku: 'ART-SNW-POL', category: 'Artic Series', finish: 'Polished', price: 46.99, stock: 112 },
  
  // Builders Range
  { name: 'Builder White Matt', sku: 'BLD-WHT-MAT', category: 'Builders range', finish: 'Matt', price: 24.99, stock: 567 },
  { name: 'Builder Grey Matt', sku: 'BLD-GRY-MAT', category: 'Builders range', finish: 'Matt', price: 24.99, stock: 432 },
  
  // Galaxy Series
  { name: 'Aspen Ash Grey', sku: 'GAL-ASP-ASH', category: 'Galaxy Series', finish: 'Matt', price: 43.99, stock: 12 },
  { name: 'Galaxy Black Polished', sku: 'GAL-BLK-POL', category: 'Galaxy Series', finish: 'Polished', price: 52.99, stock: 78 },
  
  // Marella Series
  { name: 'Bianco Matt', sku: 'MAR-BIA-MAT', category: 'Marella Series', finish: 'Matt', price: 47.99, stock: 0 },
  { name: 'Marella Cream Polished', sku: 'MAR-CRM-POL', category: 'Marella Series', finish: 'Polished', price: 49.99, stock: 145 },
  
  // Iron Series
  { name: 'Iron Grey Matt', sku: 'IRN-GRY-MAT', category: 'Iron Series', finish: 'Matt', price: 38.99, stock: 189 },
  { name: 'Iron Black Polished', sku: 'IRN-BLK-POL', category: 'Iron Series', finish: 'Polished', price: 42.99, stock: 98 },
  
  // Lavic Series
  { name: 'Lavic Stone Matt', sku: 'LAV-STN-MAT', category: 'Lavic Series', finish: 'Matt', price: 44.99, stock: 76 },
  { name: 'Lavic Sand Polished', sku: 'LAV-SND-POL', category: 'Lavic Series', finish: 'Polished', price: 46.99, stock: 54 },
  
  // Onyx Series
  { name: 'Onyx Black Polished', sku: 'ONX-BLK-POL', category: 'Onyx Series', finish: 'Polished', price: 54.99, stock: 43 },
  { name: 'Onyx White Matt', sku: 'ONX-WHT-MAT', category: 'Onyx Series', finish: 'Matt', price: 52.99, stock: 65 },
  
  // River Series
  { name: 'River Stone Matt', sku: 'RIV-STN-MAT', category: 'River Series', finish: 'Matt', price: 40.99, stock: 123 },
  { name: 'River Blue Gloss', sku: 'RIV-BLU-GLS', category: 'River Series', finish: 'Gloss', price: 43.99, stock: 87 },
  
  // Iris Series
  { name: 'Iris Grey Matt', sku: 'IRS-GRY-MAT', category: 'Iris Series', finish: 'Matt', price: 41.99, stock: 156 },
  { name: 'Iris Cream Polished', sku: 'IRS-CRM-POL', category: 'Iris Series', finish: 'Polished', price: 44.99, stock: 92 },
  
  // Kaira Series
  { name: 'Kaira White Matt', sku: 'KAI-WHT-MAT', category: 'Kaira Series', finish: 'Matt', price: 43.99, stock: 134 },
  { name: 'Kaira Beige Polished', sku: 'KAI-BEG-POL', category: 'Kaira Series', finish: 'Polished', price: 46.99, stock: 78 },
  
  // Lemo Series
  { name: 'Lemo Light Matt', sku: 'LEM-LGT-MAT', category: 'Lemo Series', finish: 'Matt', price: 39.99, stock: 167 },
  { name: 'Lemo Dark Polished', sku: 'LEM-DRK-POL', category: 'Lemo Series', finish: 'Polished', price: 42.99, stock: 98 },
];

const seedProducts = async () => {
  try {
    await connectDB();

    // Find admin user
    const admin = await User.findOne({ role: 'admin' });
    
    if (!admin) {
      console.error('Admin user not found. Please run seedAdmin.js first.');
      process.exit(1);
    }

    // Clear existing products
    await Product.deleteMany({});
    console.log('Cleared existing products');

    // Add createdBy field to all products
    const productsWithCreator = sampleProducts.map(product => ({
      ...product,
      description: `Premium ${product.category} tile`,
      size: '60x60 cm',
      unit: 'boxes',
      createdBy: admin._id,
    }));

    // Insert products
    await Product.insertMany(productsWithCreator);

    console.log(`✅ Successfully seeded ${productsWithCreator.length} products`);
    console.log('\nCategories seeded:');
    const categories = [...new Set(sampleProducts.map(p => p.category))].sort();
    categories.forEach(cat => console.log(`  - ${cat}`));
    
    console.log('\nFinishes seeded:');
    const finishes = [...new Set(sampleProducts.map(p => p.finish))].sort();
    finishes.forEach(fin => console.log(`  - ${fin}`));

    process.exit();
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
};

seedProducts();
