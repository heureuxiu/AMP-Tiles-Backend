const express = require('express');
const {
  getCustomers,
  getCustomer,
  createCustomer,
  updateCustomer,
  deleteCustomer,
  getCustomerStats,
  getCustomerMonthlyStatement,
  getCustomerMonthlyStatementPdf,
  sendCustomerMonthlyStatementEmail,
} = require('../controllers/customerController');
const { protect, authorize } = require('../middleware/auth');

const router = express.Router();

router.use(protect);

router.get('/stats/summary', authorize('admin'), getCustomerStats);

router.route('/')
  .get(getCustomers)
  .post(authorize('admin'), createCustomer);

router.get('/:id/monthly-statement', authorize('admin'), getCustomerMonthlyStatement);
router.get('/:id/monthly-statement/pdf', authorize('admin'), getCustomerMonthlyStatementPdf);
router.post('/:id/monthly-statement/send', authorize('admin'), sendCustomerMonthlyStatementEmail);

router.route('/:id')
  .get(getCustomer)
  .put(authorize('admin'), updateCustomer)
  .delete(authorize('admin'), deleteCustomer);

module.exports = router;
