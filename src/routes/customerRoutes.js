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
} = require('../controllers/customerController');
const { protect } = require('../middleware/auth');

const router = express.Router();

router.use(protect);

router.get('/stats/summary', getCustomerStats);

router.route('/').get(getCustomers).post(createCustomer);

router.get('/:id/monthly-statement', getCustomerMonthlyStatement);
router.get('/:id/monthly-statement/pdf', getCustomerMonthlyStatementPdf);

router.route('/:id').get(getCustomer).put(updateCustomer).delete(deleteCustomer);

module.exports = router;
