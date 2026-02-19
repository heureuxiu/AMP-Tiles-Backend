const express = require('express');
const {
  getTransactions,
  getTransaction,
  updateStock,
  getStockStats,
  getProductHistory,
} = require('../controllers/stockController');
const { protect } = require('../middleware/auth');

const router = express.Router();

// All routes are protected
router.use(protect);

// Stock statistics
router.get('/stats', getStockStats);

// Stock transactions
router.get('/transactions', getTransactions);
router.get('/transactions/:id', getTransaction);

// Update stock (create transaction)
router.post('/update', updateStock);

// Product stock history
router.get('/history/:productId', getProductHistory);

module.exports = router;
