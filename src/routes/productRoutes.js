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
const { protect } = require('../middleware/auth');

const router = express.Router();

// All routes are protected
router.use(protect);

router.post(
  '/import-csv',
  express.text({ type: ['text/csv', 'application/csv', 'text/plain'], limit: '5mb' }),
  importCsvProducts
);

router.route('/').get(getProducts).post(createProduct);

router.route('/:id').get(getProduct).put(updateProduct).delete(deleteProduct);

router.patch('/:id/stock', updateStock);

module.exports = router;
