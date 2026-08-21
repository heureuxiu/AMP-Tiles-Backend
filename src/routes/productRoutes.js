const express = require('express');
const {
  getProducts,
  getProduct,
  createProduct,
  updateProduct,
  deleteProduct,
  updateStock,
  importCsvProducts,
} = require('../controllers/productController');
const { protect, authorize } = require('../middleware/auth');

const router = express.Router();

// All routes are protected
router.use(protect);

router.post(
  '/import-csv',
  authorize('admin'),
  express.text({ type: ['text/csv', 'application/csv', 'text/plain'], limit: '5mb' }),
  importCsvProducts
);

router.route('/')
  .get(getProducts)
  .post(authorize('admin'), createProduct);

router.route('/:id')
  .get(getProduct)
  .put(authorize('admin'), updateProduct)
  .delete(authorize('admin'), deleteProduct);

router.patch('/:id/stock', authorize('admin'), updateStock);

module.exports = router;
