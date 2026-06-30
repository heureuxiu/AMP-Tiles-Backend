const express = require('express');
const { getDashboardSummary, getDashboardOverview } = require('../controllers/dashboardController');
const { protect } = require('../middleware/auth');

const router = express.Router();

router.use(protect);

router.get('/summary', getDashboardSummary);
router.get('/overview', getDashboardOverview);

module.exports = router;
