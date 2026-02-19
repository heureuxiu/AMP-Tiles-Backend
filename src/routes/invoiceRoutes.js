const express = require('express');
const {
  getInvoices,
  getInvoice,
  getInvoicePdf,
  createInvoice,
  updateInvoice,
  markInvoiceAsPaid,
  deleteInvoice,
  getInvoiceStats,
} = require('../controllers/invoiceController');
const { protect } = require('../middleware/auth');

const router = express.Router();

// Protect all routes
router.use(protect);

// Stats route (must be before /:id routes)
router.get('/stats/summary', getInvoiceStats);

// Main routes
router.route('/').get(getInvoices).post(createInvoice);

// PDF route (must be before /:id so /:id/pdf is matched)
router.get('/:id/pdf', getInvoicePdf);

// Individual invoice routes
router.route('/:id').get(getInvoice).put(updateInvoice).delete(deleteInvoice);

// Mark as paid route
router.post('/:id/pay', markInvoiceAsPaid);

module.exports = router;
