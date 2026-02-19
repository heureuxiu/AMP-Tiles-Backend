const express = require('express');
const {
  getQuotations,
  getQuotation,
  createQuotation,
  updateQuotation,
  deleteQuotation,
  convertToInvoice,
  getQuotationStats,
} = require('../controllers/quotationController');
const { protect } = require('../middleware/auth');

const router = express.Router();

// All routes are protected
router.use(protect);

// Statistics route
router.get('/stats/summary', getQuotationStats);

// Main CRUD routes
router.route('/').get(getQuotations).post(createQuotation);

router
  .route('/:id')
  .get(getQuotation)
  .put(updateQuotation)
  .delete(deleteQuotation);

// Convert to invoice
router.post('/:id/convert', convertToInvoice);

module.exports = router;
