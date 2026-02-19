const express = require('express');
const {
  getProducts,
  getProduct,
  createProduct,
  updateProduct,
  deleteProduct,
  updateStock,
} = require('../controllers/productController');
const { protect } = require('../middleware/auth');

const router = express.Router();

// All routes are protected
router.use(protect);

router.route('/').get(getProducts).post(createProduct);

router.route('/:id').get(getProduct).put(updateProduct).delete(deleteProduct);

router.patch('/:id/stock', updateStock);

module.exports = router;
