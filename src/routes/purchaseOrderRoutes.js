const express = require('express');
const {
  getPurchaseOrders,
  getPurchaseOrder,
  getPurchaseOrderPdf,
  createPurchaseOrder,
  updatePurchaseOrder,
  sendPurchaseOrderToSupplier,
  receivePurchaseOrder,
  deletePurchaseOrder,
  getPurchaseOrderStats,
} = require('../controllers/purchaseOrderController');
const { protect } = require('../middleware/auth');

const router = express.Router();

// Protect all routes
router.use(protect);

// Stats route (must be before /:id route)
router.get('/stats/summary', getPurchaseOrderStats);

// Main routes
router.route('/').get(getPurchaseOrders).post(createPurchaseOrder);

// PDF route
router.get('/:id/pdf', getPurchaseOrderPdf);

router.route('/:id').get(getPurchaseOrder).put(updatePurchaseOrder).delete(deletePurchaseOrder);

// Send purchase order to supplier email route
router.post('/:id/send-to-supplier', sendPurchaseOrderToSupplier);

// Receive purchase order route
router.post('/:id/receive', receivePurchaseOrder);

module.exports = router;
