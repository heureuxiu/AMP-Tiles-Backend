const express = require('express');
const quotationController = require('../controllers/quotationController');
const { protect } = require('../middleware/auth');

const router = express.Router();

function safeHandler(handler, name) {
  if (typeof handler === 'function') return handler;
  return (req, res) => {
    res.status(500).json({
      success: false,
      message: `Quotation controller handler "${name}" is not configured`,
    });
  };
}

const getQuotations = safeHandler(quotationController.getQuotations, 'getQuotations');
const getQuotation = safeHandler(quotationController.getQuotation, 'getQuotation');
const createQuotation = safeHandler(quotationController.createQuotation, 'createQuotation');
const updateQuotation = safeHandler(quotationController.updateQuotation, 'updateQuotation');
const deleteQuotation = safeHandler(quotationController.deleteQuotation, 'deleteQuotation');
const convertToInvoice = safeHandler(quotationController.convertToInvoice, 'convertToInvoice');
const getQuotationStats = safeHandler(quotationController.getQuotationStats, 'getQuotationStats');

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
