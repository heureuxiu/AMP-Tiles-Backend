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

  function formatNumber(amount) {
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

  function toCents(value) {
    return Math.round((Number(value) || 0) * 100);
  }

  function getPaymentStatusLabel(status) {
    if (status === 'paid') return 'Fully Paid';
    if (status === 'partially_paid') return 'Partially Paid';
    if (status === 'unpaid') return 'Unpaid';
    return String(status || 'Unpaid')
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (char) => char.toUpperCase());
  }

  function formatQuantity(value) {
    const numeric = Number(value) || 0;
    const rounded = Math.round(numeric * 1000) / 1000;
    if (Number.isInteger(rounded)) return String(rounded);
    return rounded.toFixed(3).replace(/\.?0+$/, '');
  }

  function getItemSize(item) {
    const rawSize = item?.product?.size ?? item?.size;
    return rawSize ? String(rawSize) : '';
  }

  function getItemSku(item) {
    const rawSku = item?.sku ?? item?.product?.sku;
    return rawSku ? String(rawSku) : '';
  }

  function getDeliveryAddress(source) {
    return String(source?.deliveryAddress || source?.customerAddress || '').trim();
  }

  function getLogoBase64() {
    try {
      const logoPath = path.resolve(__dirname, '../../../client/public/assets/AMP-TILES-LOGO.png');
      const logoBuffer = fs.readFileSync(logoPath);
      return `data:image/png;base64,${logoBuffer.toString('base64')}`;
    } catch (e) {
      return '';
    }
  }

  function buildInvoiceHtml(invoice, companyInfo = {}) {
    const company = {
      name: companyInfo.name || 'AMP TILES PTY LTD',
      addressLine1: companyInfo.addressLine1 || 'Unit 15/55 Anderson Road',
      addressLine2: companyInfo.addressLine2 || 'SMEATON GRANGE',
      addressLine3: companyInfo.addressLine3 || 'NSW 2560',
      country: companyInfo.country || 'AUSTRALIA',
      abn: companyInfo.abn || '14 690 181 858',
      bank: companyInfo.bank || 'NAB',
      accountName: companyInfo.accountName || 'AMP TILES PTY LTD',
      bsb: companyInfo.bsb || '082-356',
      accountNumber: companyInfo.accountNumber || '26-722-1347',
    };

    const logoSrc = getLogoBase64();
    const inv = invoice;
    const deliveryAddress = getDeliveryAddress(inv);

    const rowsHtml = (inv.items || []).map(
      (item) => `
      <tr>
        <td>${escapeHtml(item.productName)}</td>
        <td>${escapeHtml(getItemSku(item))}</td>
        <td>${escapeHtml(getItemSize(item))}</td>
        <td>${escapeHtml(item.unitType || '')}</td>
        <td class="center">${escapeHtml(formatQuantity(item.quantity))}</td>
        <td class="right">${formatNumber(item.rate)}</td>
        <td class="center">${item.taxPercent ? item.taxPercent + '%' : (inv.taxRate ? inv.taxRate + '%' : '10%')}</td>
        <td class="right">${formatNumber(item.lineTotal)}</td>
      </tr>`
    ).join('');

    const subtotal = inv.subtotal ?? (inv.items || []).reduce((s, i) => s + (i.lineTotal || 0), 0);
    const discountAmount = inv.discountAmount ?? inv.discount ?? 0;
    const tax = inv.tax ?? 0;
    const baseTotal = subtotal - discountAmount + tax;
    const parsedDeliveryCost = Number(inv.deliveryCost);
    const fallbackDeliveryCost = Math.max(
      0,
      Math.round((Number(inv.grandTotal) - baseTotal) * 100) / 100
    );
    const deliveryCost = Number.isFinite(parsedDeliveryCost)
      ? Math.max(0, parsedDeliveryCost)
      : Number.isFinite(fallbackDeliveryCost)
        ? fallbackDeliveryCost
        : 0;
    const grandTotal = Number.isFinite(Number(inv.grandTotal))
      ? Number(inv.grandTotal)
      : Math.round((baseTotal + deliveryCost) * 100) / 100;
    const grandTotalCents = Math.max(0, toCents(grandTotal));
    const paidCents = Math.max(0, Math.min(grandTotalCents, toCents(inv.amountPaid)));
    const outstandingCents = Math.max(0, grandTotalCents - paidCents);
    const computedPaymentStatus =
      paidCents <= 0 ? 'unpaid' : paidCents >= grandTotalCents ? 'paid' : 'partially_paid';
    const paymentStatus = inv.paymentStatus || computedPaymentStatus;
    const paymentStatusLabel = getPaymentStatusLabel(paymentStatus);

    const dueDateLabel = inv.dueDate ? formatDate(inv.dueDate) : 'N/A';
    const taxRate = inv.taxRate || 10;

    // Delivery row for the table
    const deliveryRowHtml = deliveryCost > 0 ? `
      <tr>
        <td>Delivery Cost</td>
        <td></td>
        <td></td>
        <td></td>
        <td class="center">1</td>
        <td class="right">${formatNumber(deliveryCost)}</td>
        <td class="center">${taxRate}%</td>
        <td class="right">${formatNumber(deliveryCost)}</td>
      </tr>` : '';

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

      /* ── Logo + Company Block (top-right) ── */
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

      /* ── Header grid: customer left, meta+company right ── */
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

      /* ── Items Table ── */
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

      /* ── Totals ── */
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

      /* ── Payment Status ── */
      .payment-section {
        margin-bottom: 18px;
        padding: 12px 14px;
        border: 1px solid #ddd;
        border-radius: 6px;
        background: #fafafa;
        display: flex;
        justify-content: space-between;
        align-items: center;
        font-size: 12.5px;
      }
      .payment-section .ps-row {
        display: flex;
        gap: 20px;
      }
      .payment-section .ps-label {
        color: #666;
      }
      .payment-section .ps-value {
        font-weight: 700;
      }
      .badge {
        display: inline-block;
        padding: 3px 12px;
        border-radius: 999px;
        font-size: 11px;
        font-weight: 700;
      }
      .badge-paid { background: #dcfce7; color: #166534; }
      .badge-partial { background: #fef3c7; color: #92400e; }
      .badge-unpaid { background: #fee2e2; color: #991b1b; }

      /* ── Footer / Bank ── */
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
      .footer-block .due-date {
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
      <div class="doc-title">TAX INVOICE</div>
      <div class="logo-company">
        ${logoSrc ? `<img src="${logoSrc}" alt="Logo" />` : ''}
      </div>
    </div>

    <!-- Customer + Meta + Company -->
    <div class="header-grid">
      <div class="customer-block">
        <p class="cust-name">${escapeHtml(inv.customerName || '')}</p>
        ${deliveryAddress ? `<p><strong>Delivery Address:</strong> ${escapeHtml(deliveryAddress)}</p>` : ''}
        ${inv.customerPhone ? `<p>${escapeHtml(inv.customerPhone)}</p>` : ''}
        ${inv.customerEmail ? `<p>${escapeHtml(inv.customerEmail)}</p>` : ''}
      </div>
      <table class="meta-company-table">
        <tr>
          <td class="label-col">Invoice Date</td>
          <td class="value-col">${escapeHtml(formatDate(inv.invoiceDate))}</td>
          <td class="company-col" rowspan="5" style="vertical-align: top; line-height: 1.6;">
            ${escapeHtml(company.name)}<br>
            ${escapeHtml(company.addressLine1)}<br>
            ${escapeHtml(company.addressLine2)}<br>
            ${escapeHtml(company.addressLine3)}<br>
            ${escapeHtml(company.country)}
          </td>
        </tr>
        <tr>
          <td class="label-col">Invoice Number</td>
          <td class="value-col">${escapeHtml(inv.invoiceNumber || '')}</td>
        </tr>
        <tr>
          <td class="label-col">Reference</td>
          <td class="value-col">${inv.quotation && inv.quotation.quotationNumber ? escapeHtml(inv.quotation.quotationNumber) : (inv.reference ? escapeHtml(inv.reference) : '')}</td>
        </tr>
        <tr>
          <td class="label-col">Status</td>
          <td class="value-col">${escapeHtml(paymentStatusLabel)}</td>
        </tr>
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
          <th>Description</th>
          <th>SKU</th>
          <th>Size</th>
          <th>Unit</th>
          <th class="center">Quantity</th>
          <th class="right">Unit Price</th>
          <th class="center">GST</th>
          <th class="right">Amount AUD</th>
        </tr>
      </thead>
      <tbody>
        ${rowsHtml}
        ${deliveryRowHtml}
      </tbody>
    </table>

    <!-- Totals -->
    <div class="totals-wrapper">
      <table class="totals-table">
        <tr>
          <td class="t-label">Subtotal</td>
          <td class="t-value">${formatNumber(subtotal)}</td>
        </tr>
        ${discountAmount > 0 ? `<tr><td class="t-label">Discount</td><td class="t-value">-${formatNumber(discountAmount)}</td></tr>` : ''}
        ${deliveryCost > 0 ? `<tr><td class="t-label">Delivery Cost</td><td class="t-value">${formatNumber(deliveryCost)}</td></tr>` : ''}
        <tr>
          <td class="t-label">TOTAL GST ${taxRate}%</td>
          <td class="t-value">${formatNumber(tax)}</td>
        </tr>
        <tr class="grand-row">
          <td class="t-label">TOTAL AUD</td>
          <td class="t-value">${formatNumber(grandTotal)}</td>
        </tr>
      </table>
    </div>

    <!-- Payment Info -->
    <div class="payment-section">
      <div class="ps-row">
        <span><span class="ps-label">Amount Received:</span> <span class="ps-value">${formatNumber(paidCents / 100)}</span></span>
        <span><span class="ps-label">Outstanding:</span> <span class="ps-value">${formatNumber(outstandingCents / 100)}</span></span>
      </div>
      <span class="badge ${paymentStatus === 'paid' ? 'badge-paid' : paymentStatus === 'partially_paid' ? 'badge-partial' : 'badge-unpaid'}">${escapeHtml(paymentStatusLabel)}</span>
    </div>

    <!-- Notes / Terms -->
    ${inv.notes ? `<div class="notes-section"><strong>Notes:</strong> ${escapeHtml(inv.notes)}</div>` : ''}
    ${inv.terms ? `<div class="notes-section" style="margin-top:8px;"><strong>Terms:</strong> ${escapeHtml(inv.terms)}</div>` : ''}

    <!-- Bank Details + Due Date -->
    <div class="footer-block">
      <p class="due-date">Due Date: ${escapeHtml(dueDateLabel)}</p>
      <p><strong>Account Name:</strong> ${escapeHtml(company.accountName)}</p>
      <p><strong>BSB Number:</strong> ${escapeHtml(company.bsb)}</p>
      <p><strong>Account Number:</strong> ${escapeHtml(company.accountNumber)}</p>
    </div>

    <p class="footer-note">This is a computer-generated invoice and does not require a signature.</p>

  </body>
  </html>`;
  }

  async function generateInvoicePdf(invoice) {
    const puppeteer = getPuppeteer();
    const html = buildInvoiceHtml(invoice);
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

  module.exports = { generateInvoicePdf, buildInvoiceHtml };
