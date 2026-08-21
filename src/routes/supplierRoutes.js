const express = require('express');
const {
  getSuppliers,
  getSupplier,
  createSupplier,
  updateSupplier,
  deleteSupplier,
  getSupplierStats,
} = require('../controllers/supplierController');
const { protect, authorize } = require('../middleware/auth');

const router = express.Router();

// Protect all routes
router.use(protect);

// Stats route (must be before /:id route)
router.get('/stats/summary', authorize('admin'), getSupplierStats);

// Main routes
router.route('/')
  .get(getSuppliers)
  .post(authorize('admin'), createSupplier);

router.route('/:id')
  .get(getSupplier)
  .put(authorize('admin'), updateSupplier)
  .delete(authorize('admin'), deleteSupplier);

module.exports = router;
