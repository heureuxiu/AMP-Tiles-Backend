const fs = require('fs');
const { readLogoBase64 } = require('./logoResolver');
const { getPuppeteer, launchPuppeteerBrowser } = require('./puppeteerLauncher');

function escapeHtml(text) {
  if (text == null) return '';
  const s = String(text);
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatNumber(amount, currency = 'AUD') {
  return new Intl.NumberFormat('en-AU', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(amount) || 0);
}

function formatDate(date) {
  if (!date) return '';
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return '';
  const day = d.getDate();
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${day} ${months[d.getMonth()]} ${d.getFullYear()}`;
}

function getItemSize(item) {
  const rawSize = item?.product?.size ?? item?.size;
  return rawSize ? String(rawSize) : '';
}

function getLogoBase64() {
  return readLogoBase64();
}

function buildPurchaseOrderHtml(purchaseOrder, companyInfo = {}) {
  const company = {
    name: companyInfo.name || 'AMP TILES PTY LTD',
    addressLine1: companyInfo.addressLine1 || 'Unit 15/55 Anderson Road',
    addressLine2: companyInfo.addressLine2 || 'SMEATON GRANGE',
    addressLine3: companyInfo.addressLine3 || 'NSW 2560',
    country: companyInfo.country || 'AUSTRALIA',
    abn: companyInfo.abn || '14 690 181 858',
  };

  const logoSrc = getLogoBase64();
  const po = purchaseOrder;
  const currency = po.currency || 'AUD';

  const supplierName = po.supplierName || po.supplier?.name || '';
  const supplierContact = po.supplier?.contactPerson || '';
  const supplierEmail = po.supplier?.email || '';
  const supplierPhone = po.supplier?.phone || '';

  const rowsHtml = (po.items || [])
    .map(
      (item) => `
    <tr>
      <td>${escapeHtml(item.sku || '')}</td>
      <td>${escapeHtml(item.productName || item.product?.name || '')}</td>
      <td>${escapeHtml(getItemSize(item))}</td>
      <td class="center">${escapeHtml(String(item.quantityOrdered ?? 0))}</td>
      <td class="right">${formatNumber(item.rate)}</td>
      <td class="center">${item.taxPercent ? item.taxPercent + '%' : '10%'}</td>
      <td class="right">${formatNumber(item.lineTotal)}</td>
    </tr>`
    )
    .join('');

  const subtotal = po.subtotal ?? (po.items || []).reduce((s, i) => s + (i.lineTotal || 0), 0);
  const tax = po.tax ?? 0;
  const grandTotal = po.grandTotal ?? subtotal + tax;

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Segoe UI', Arial, Helvetica, sans-serif;
      font-size: 13px;
      color: #1a1a2e;
      padding: 40px 45px;
      line-height: 1.5;
    }

    .top-section {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 10px;
    }
    .doc-title {
      font-size: 28px;
      font-weight: 800;
      color: #1a1a2e;
      letter-spacing: 1px;
    }
    .logo-company {
      text-align: right;
    }
    .logo-company img {
      height: 54px;
      margin-bottom: 4px;
    }

    .header-grid {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 30px;
      margin-bottom: 28px;
    }
    .customer-block {
      flex: 1;
      padding-top: 4px;
    }
    .customer-block .cust-name {
      font-weight: 700;
      font-size: 14px;
      margin-bottom: 2px;
    }
    .customer-block p {
      margin: 1px 0;
      font-size: 12.5px;
      color: #333;
    }
    .customer-block .section-label {
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: #888;
      font-weight: 700;
      margin-bottom: 4px;
    }
    .meta-company-table {
      border-collapse: collapse;
      font-size: 12.5px;
    }
    .meta-company-table td {
      border: 1px solid #bbb;
      padding: 5px 10px;
      vertical-align: top;
    }
    .meta-company-table .label-col {
      font-weight: 600;
      color: #444;
      white-space: nowrap;
      background: #fafafa;
    }
    .meta-company-table .value-col {
      min-width: 100px;
    }
    .meta-company-table .company-col {
      font-weight: 600;
      color: #1a1a2e;
      min-width: 140px;
    }

    table.items {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 14px;
      font-size: 12.5px;
    }
    table.items thead {
      background: #f0f0f4;
    }
    table.items th {
      padding: 9px 10px;
      text-align: left;
      font-weight: 700;
      font-size: 11.5px;
      color: #333;
      border: 1px solid #bbb;
    }
    table.items th.center, table.items td.center { text-align: center; }
    table.items th.right, table.items td.right { text-align: right; }
    table.items td {
      padding: 8px 10px;
      border: 1px solid #ccc;
      color: #1a1a2e;
    }
    table.items tbody tr:nth-child(even) {
      background: #fafafa;
    }

    .totals-wrapper {
      display: flex;
      justify-content: flex-end;
      margin-bottom: 22px;
    }
    .totals-table {
      border-collapse: collapse;
      font-size: 13px;
      min-width: 300px;
    }
    .totals-table td {
      padding: 6px 12px;
      border: 1px solid #bbb;
    }
    .totals-table .t-label {
      text-align: right;
      font-weight: 600;
      color: #444;
      background: #fafafa;
    }
    .totals-table .t-value {
      text-align: right;
      font-weight: 700;
      min-width: 110px;
    }
    .totals-table .grand-row td {
      background: #f0f0f4;
      font-size: 14.5px;
      font-weight: 800;
      color: #1a1a2e;
    }

    .footer-block {
      margin-top: 18px;
      padding-top: 14px;
      border-top: 2px solid #1a1a2e;
    }
    .footer-block p {
      margin: 2px 0;
      font-size: 12.5px;
      color: #333;
    }
    .footer-block .delivery-label {
      font-weight: 700;
      font-size: 13.5px;
      margin-bottom: 6px;
      color: #1a1a2e;
    }
    .footer-note {
      margin-top: 22px;
      text-align: center;
      font-size: 11.5px;
      color: #888;
    }
    .notes-section {
      margin-top: 14px;
      padding: 10px 14px;
      border: 1px solid #ddd;
      border-radius: 6px;
      font-size: 12.5px;
      color: #444;
      background: #fafafa;
    }
    .notes-section strong {
      color: #222;
    }
  </style>
</head>
<body>

  <!-- Logo + Title -->
  <div class="top-section">
    <div class="doc-title">PURCHASE ORDER</div>
    <div class="logo-company">
      ${logoSrc ? `<img src="${logoSrc}" alt="Logo" />` : ''}
    </div>
  </div>

  <!-- Supplier + Meta + Company -->
  <div class="header-grid">
    <div class="customer-block">
      <p class="section-label">Supplier</p>
      <p class="cust-name">${escapeHtml(supplierName)}</p>
      ${supplierContact ? `<p>Contact: ${escapeHtml(supplierContact)}</p>` : ''}
      ${supplierPhone ? `<p>Phone: ${escapeHtml(supplierPhone)}</p>` : ''}
      ${supplierEmail ? `<p>Email: ${escapeHtml(supplierEmail)}</p>` : ''}
    </div>
    <table class="meta-company-table">
      <tr>
        <td class="label-col">PO Date</td>
        <td class="value-col">${escapeHtml(formatDate(po.poDate))}</td>
        <td class="company-col" rowspan="5" style="vertical-align: top; line-height: 1.6;">
          ${escapeHtml(company.name)}<br>
          ${escapeHtml(company.addressLine1)}<br>
          ${escapeHtml(company.addressLine2)}<br>
          ${escapeHtml(company.addressLine3)}<br>
          ${escapeHtml(company.country)}
        </td>
      </tr>
      <tr>
        <td class="label-col">PO Number</td>
        <td class="value-col">${escapeHtml(po.poNumber || '')}</td>
      </tr>
      <tr>
        <td class="label-col">Expected Delivery</td>
        <td class="value-col">${escapeHtml(po.expectedDeliveryDate ? formatDate(po.expectedDeliveryDate) : 'N/A')}</td>
      </tr>
      ${po.paymentTerms ? `<tr>
        <td class="label-col">Payment Terms</td>
        <td class="value-col">${escapeHtml(po.paymentTerms)}</td>
      </tr>` : `<tr>
        <td class="label-col">Warehouse</td>
        <td class="value-col">${escapeHtml(po.warehouseLocation || 'N/A')}</td>
      </tr>`}
      <tr>
        <td class="label-col">ABN</td>
        <td class="value-col">${escapeHtml(company.abn)}</td>
      </tr>
    </table>
  </div>

  <!-- Items Table -->
  <table class="items">
    <thead>
      <tr>
        <th>Item/SKU</th>
        <th>Description</th>
        <th>Size</th>
        <th class="center">Quantity</th>
        <th class="right">Unit Price</th>
        <th class="center">GST</th>
        <th class="right">Amount ${escapeHtml(currency)}</th>
      </tr>
    </thead>
    <tbody>
      ${rowsHtml}
    </tbody>
  </table>

  <!-- Totals -->
  <div class="totals-wrapper">
    <table class="totals-table">
      <tr>
        <td class="t-label">Subtotal</td>
        <td class="t-value">${formatNumber(subtotal)}</td>
      </tr>
      ${tax > 0 ? `<tr><td class="t-label">TOTAL GST</td><td class="t-value">${formatNumber(tax)}</td></tr>` : ''}
      <tr class="grand-row">
        <td class="t-label">TOTAL ${escapeHtml(currency)}</td>
        <td class="t-value">${formatNumber(grandTotal)}</td>
      </tr>
    </table>
  </div>

  <!-- Notes / Terms / Delivery -->
  ${po.deliveryAddress ? `<div class="notes-section"><strong>Delivery Address:</strong> ${escapeHtml(po.deliveryAddress)}</div>` : ''}
  ${po.notes ? `<div class="notes-section" style="margin-top:8px;"><strong>Notes:</strong> ${escapeHtml(po.notes)}</div>` : ''}
  ${po.terms ? `<div class="notes-section" style="margin-top:8px;"><strong>Terms:</strong> ${escapeHtml(po.terms)}</div>` : ''}

  <!-- Footer -->
  <div class="footer-block">
    ${po.expectedDeliveryDate ? `<p class="delivery-label">Expected Delivery: ${escapeHtml(formatDate(po.expectedDeliveryDate))}</p>` : ''}
    ${po.warehouseLocation ? `<p><strong>Warehouse:</strong> ${escapeHtml(po.warehouseLocation)}</p>` : ''}
    ${po.paymentTerms ? `<p><strong>Payment Terms:</strong> ${escapeHtml(po.paymentTerms)}</p>` : ''}
  </div>

  <p class="footer-note">This is a computer-generated purchase order and does not require a signature.</p>

</body>
</html>`;
}

async function generatePurchaseOrderPdf(purchaseOrder) {
  const puppeteer = getPuppeteer();
  const html = buildPurchaseOrderHtml(purchaseOrder);
  let browser;
  try {
    browser = await launchPuppeteerBrowser(puppeteer);
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '20px', right: '20px', bottom: '20px', left: '20px' },
    });
    return Buffer.from(pdfBuffer);
  } finally {
    if (browser) await browser.close();
  }
}

module.exports = { generatePurchaseOrderPdf, buildPurchaseOrderHtml };
