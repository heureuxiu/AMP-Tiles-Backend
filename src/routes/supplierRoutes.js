const express = require('express');
const {
  getSuppliers,
  getSupplier,
  createSupplier,
  updateSupplier,
  deleteSupplier,
  getSupplierStats,
} = require('../controllers/supplierController');
const { protect } = require('../middleware/auth');

const router = express.Router();

// Protect all routes
router.use(protect);

// Stats route (must be before /:id route)
router.get('/stats/summary', getSupplierStats);

// Main routes
router.route('/').get(getSuppliers).post(createSupplier);

router.route('/:id').get(getSupplier).put(updateSupplier).delete(deleteSupplier);

module.exports = router;
