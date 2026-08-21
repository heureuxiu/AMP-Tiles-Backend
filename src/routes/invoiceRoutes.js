const express = require('express');
const {
  getInvoices,
  getInvoice,
  getInvoicePdf,
  getPackingSlipPdf,
  createInvoice,
  updateInvoice,
  markInvoiceAsPaid,
  sendInvoiceEmail,
  deleteInvoice,
  getInvoiceStats,
} = require('../controllers/invoiceController');
const { protect, authorize } = require('../middleware/auth');
const { uploadEmailAttachments } = require('../middleware/emailAttachments');

const router = express.Router();

// Protect all routes
router.use(protect);

// Stats route (must be before /:id routes)
router.get('/stats/summary', getInvoiceStats);

// Main routes
router.route('/').get(getInvoices).post(uploadEmailAttachments, createInvoice);

// PDF route (must be before /:id so /:id/pdf is matched)
router.get('/:id/pdf', getInvoicePdf);
router.get('/:id/packing-slip', getPackingSlipPdf);

// Individual invoice routes
router.route('/:id')
  .get(getInvoice)
  .put(uploadEmailAttachments, updateInvoice)
  .delete(authorize('admin'), deleteInvoice);

// Mark as paid route
router.post('/:id/pay', authorize('admin'), markInvoiceAsPaid);
router.post('/:id/send', uploadEmailAttachments, sendInvoiceEmail);

module.exports = router;
