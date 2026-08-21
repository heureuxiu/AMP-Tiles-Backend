const express = require('express');
const {
  getTransactions,
  getTransaction,
  updateStock,
  getStockStats,
  getProductHistory,
} = require('../controllers/stockController');
const { protect, authorize } = require('../middleware/auth');

const router = express.Router();

// All routes are protected and restricted to admin
router.use(protect);
router.use(authorize('admin'));

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
