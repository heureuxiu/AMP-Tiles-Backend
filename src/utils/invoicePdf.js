  const fs = require('fs');
  const path = require('path');
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
  const SQFT_PER_SQM = 10.764;

  function getDisplayQuantity(item) {
    const unitType = String(item?.unitType || '').toLowerCase();
    const coverageSqm = Number(item?.coverageSqm);
    if (Number.isFinite(coverageSqm) && coverageSqm > 0) {
      if (
        unitType.includes('sqft') ||
        unitType.includes('sq ft') ||
        unitType.includes('sqfeet')
      ) {
        return formatQuantity(coverageSqm * SQFT_PER_SQM);
      }
      if (
        unitType.includes('sqm') ||
        unitType.includes('sq meter') ||
        unitType.includes('sqmetre')
      ) {
        return formatQuantity(coverageSqm);
      }
    }
    return formatQuantity(item?.quantity ?? 0);
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

    // Derive effective GST rate from items (each item stores taxPercent); fallback to invoice taxRate or 10
    const items = inv.items || [];
    const effectiveTaxRate = items.length > 0
      ? Number(items[0].taxPercent ?? inv.taxRate ?? 10)
      : Number(inv.taxRate ?? 10);
    const taxRate = effectiveTaxRate > 0 ? effectiveTaxRate : 10;

    const rowsHtml = items.map(
      (item) => `
      <tr>
        <td>${escapeHtml(item.productName)}</td>
        <td>${escapeHtml(getItemSku(item))}</td>
        <td>${escapeHtml(getItemSize(item))}</td>
        <td>${escapeHtml(item.unitType || '')}</td>
        <td class="center">${escapeHtml(getDisplayQuantity(item))}</td>
        <td class="right">${formatNumber(item.rate)}</td>
        <td class="center">${item.discountPercent != null && item.discountPercent > 0 ? item.discountPercent + '%' : '-'}</td>
        <td class="center">${item.taxPercent != null ? item.taxPercent + '%' : taxRate + '%'}</td>
        <td class="right">${formatNumber(item.lineTotal)}</td>
      </tr>`
    ).join('');

    // Recompute totals from lineTotals for accuracy (avoids relying on potentially stale stored values)
    const itemsPreTax = Math.round(items.reduce((sum, item) => {
      const taxP = Number(item.taxPercent ?? taxRate);
      return sum + (Number(item.lineTotal || 0) / (1 + taxP / 100));
    }, 0) * 100) / 100;
    const itemsGst = Math.round(items.reduce((sum, item) => {
      const taxP = Number(item.taxPercent ?? taxRate);
      const lt = Number(item.lineTotal || 0);
      return sum + (lt - lt / (1 + taxP / 100));
    }, 0) * 100) / 100;
    const discountAmount = inv.discountAmount ?? inv.discount ?? 0;
    const deliveryCost = Math.max(0, Number(inv.deliveryCost) || 0);
    const deliveryGst = Math.round(deliveryCost * (taxRate / 100) * 100) / 100;
    const deliveryTotal = Math.round((deliveryCost + deliveryGst) * 100) / 100;
    const grandTotal = Math.round((itemsPreTax - discountAmount + itemsGst + deliveryCost + deliveryGst) * 100) / 100;

    const grandTotalCents = Math.max(0, toCents(grandTotal));
    const paidCents = Math.max(0, Math.min(grandTotalCents, toCents(inv.amountPaid)));
    const outstandingCents = Math.max(0, grandTotalCents - paidCents);
    const computedPaymentStatus =
      paidCents <= 0 ? 'unpaid' : paidCents >= grandTotalCents ? 'paid' : 'partially_paid';
    const paymentStatus = inv.paymentStatus || computedPaymentStatus;
    const paymentStatusLabel = getPaymentStatusLabel(paymentStatus);

    const dueDateLabel = inv.dueDate ? formatDate(inv.dueDate) : 'N/A';
    const referenceLabel = String(
      inv.reference || (inv.quotation && inv.quotation.quotationNumber) || ''
    ).trim();

    const invoiceStatusLabel = String(inv.status || 'draft')
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase());
    const deliveryRowHtml = deliveryCost > 0 ? `
      <tr>
        <td>Delivery Cost</td>
        <td></td>
        <td></td>
        <td></td>
        <td class="center">1</td>
        <td class="right">${formatNumber(deliveryCost)}</td>
        <td class="center">-</td>
        <td class="center">${taxRate}%</td>
        <td class="right">${formatNumber(deliveryTotal)}</td>
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
      .top-reference {
        font-size: 11.5px;
        color: #333;
        margin-top: 2px;
      }
      .top-reference strong {
        color: #1a1a2e;
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

      /* ── Terms and Conditions ── */
      .tnc-section {
        margin-top: 30px;
        padding-top: 20px;
        border-top: 2px solid #1a1a2e;
        page-break-before: always;
      }
      .tnc-header {
        font-size: 15px;
        font-weight: 800;
        color: #1a1a2e;
        letter-spacing: 0.5px;
        margin-bottom: 10px;
        text-transform: uppercase;
      }
      .tnc-intro {
        font-size: 10.5px;
        color: #333;
        line-height: 1.6;
        margin-bottom: 12px;
      }
      .tnc-clause-title {
        font-size: 11px;
        font-weight: 700;
        color: #1a1a2e;
        margin-top: 10px;
        margin-bottom: 4px;
      }
      .tnc-p {
        font-size: 10px;
        color: #444;
        line-height: 1.55;
        margin: 2px 0 2px 10px;
      }
    </style>
  </head>
  <body>

    <!-- Logo + Title -->
    <div class="top-section">
      <div class="doc-title">TAX INVOICE</div>
      <div class="logo-company">
        ${logoSrc ? `<img src="${logoSrc}" alt="Logo" />` : ''}
        ${referenceLabel ? `<div class="top-reference"><strong>Reference:</strong> ${escapeHtml(referenceLabel)}</div>` : ''}
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
          <td class="value-col">${escapeHtml(referenceLabel)}</td>
        </tr>
        <tr>
          <td class="label-col">Status</td>
          <td class="value-col">${escapeHtml(invoiceStatusLabel)}</td>
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
          <th>PRODUCT</th>
          <th>SKU</th>
          <th>SIZE</th>
          <th>UNIT</th>
          <th class="center">QTY</th>
          <th class="right">RATE</th>
          <th class="center">DISC%</th>
          <th class="center">TAX%</th>
          <th class="right">AMOUNT AUD</th>
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
          <td class="t-label">Subtotal (ex. GST)</td>
          <td class="t-value">${formatNumber(itemsPreTax)}</td>
        </tr>
        ${discountAmount > 0 ? `<tr><td class="t-label">Discount</td><td class="t-value">-${formatNumber(discountAmount)}</td></tr>` : ''}
        ${itemsGst > 0 ? `<tr><td class="t-label">Items GST (${taxRate}%)</td><td class="t-value">${formatNumber(itemsGst)}</td></tr>` : ''}
        ${deliveryCost > 0 ? `<tr><td class="t-label">Delivery Cost</td><td class="t-value">${formatNumber(deliveryCost)}</td></tr>` : ''}
        ${deliveryGst > 0 ? `<tr><td class="t-label">Delivery GST (${taxRate}%)</td><td class="t-value">${formatNumber(deliveryGst)}</td></tr>` : ''}
        <tr class="grand-row">
          <td class="t-label">TOTAL AUD</td>
          <td class="t-value">${formatNumber(grandTotal)}</td>
        </tr>
      </table>
    </div>

    <!-- Payment Info -->
    <div class="payment-section">
      <div class="ps-row">
        <span><span class="ps-label">Total Amount:</span> <span class="ps-value">${formatNumber(grandTotal)}</span></span>
        <span><span class="ps-label">Amount Received:</span> <span class="ps-value">${formatNumber(paidCents / 100)}</span></span>
        <span><span class="ps-label">Remaining:</span> <span class="ps-value">${formatNumber(outstandingCents / 100)}</span></span>
        ${inv.paymentMethod ? `<span><span class="ps-label">Method:</span> <span class="ps-value">${escapeHtml(String(inv.paymentMethod).replace(/_/g, ' '))}</span></span>` : ''}
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

    <!-- Terms and Conditions -->
    <div class="tnc-section">
      <div class="tnc-header">Terms and Conditions</div>
      <p class="tnc-intro">These Terms and Conditions (this Agreement) contain the terms and conditions that apply to all orders which you place with us (your order) and is an agreement between AMP Tiles Pty Ltd ABN 14 690 181 858 (us, we, our) and you or, if applicable, the company you represent (you, your). This Agreement takes effect on the date you accept our quotation and we issue the invoice (Commencement Date). Where you act on behalf of a company or another entity, you agree and personally warrant that you are duly authorised by that entity to enter into this Agreement with us.</p>

      <div class="tnc-clause-title">1&nbsp;&nbsp;Your order</div>
      <p class="tnc-p">1.1&nbsp;&nbsp;You wish to purchase the products from us (Products), which we wish to sell to you, on the terms and conditions of this Agreement.</p>
      <p class="tnc-p">1.2&nbsp;&nbsp;During the term of the Agreement, the terms and conditions set out in this Agreement: (a) apply to any Products supplied to you by us; and (b) are incorporated into each Order agreed between the parties.</p>
      <p class="tnc-p">1.3&nbsp;&nbsp;This Agreement does not create any obligation on us to supply Products to you unless we have agreed to accept your order and we reserve the right to accept or reject your order in whole or in part for any reason.</p>
      <p class="tnc-p">1.4&nbsp;&nbsp;We may accept your order by providing you with notice.</p>
      <p class="tnc-p">1.5&nbsp;&nbsp;Unless otherwise agreed in writing, you agree and acknowledge that we will not process your order until any deposit we require as part of your order (Deposit) is received by us as cleared funds.</p>
      <p class="tnc-p">1.6&nbsp;&nbsp;On receipt of your Deposit (and our acceptance of your order under clause 1.5), we will commence the process to supply and deliver (as applicable) the Products set out in your order.</p>

      <div class="tnc-clause-title">2&nbsp;&nbsp;Special orders</div>
      <p class="tnc-p">2.1&nbsp;&nbsp;Where your order relates to Products which we do not have in stock (Special Orders), we will use our best endeavours to ensure the prompt supply and delivery (if applicable) of the Products for you.</p>
      <p class="tnc-p">2.2&nbsp;&nbsp;However, you acknowledge and agree that Special Orders may be delayed, blocked or refused due to a wide range of circumstances including lack of required materials, manufacturing delays, shipping delays and/or customs delays.</p>
      <p class="tnc-p">2.3&nbsp;&nbsp;In the event that a Special Order is delayed, blocked or refused, you agree that we are not liable for any loss you may suffer (including indirect loss) in connection with your order.</p>

      <div class="tnc-clause-title">3&nbsp;&nbsp;The Products</div>
      <p class="tnc-p">3.1&nbsp;&nbsp;We rely on specifications provided by our suppliers to determine the quality, suitability, fitness for purpose and performance of the Products and we agree to provide you with the relevant supplier specifications applicable to the Products on request.</p>
      <p class="tnc-p">3.2&nbsp;&nbsp;You agree that you have not relied on any representations made by us in relation to the quality, suitability, fitness for purpose or performance of the Products and have solely relied on the specifications provided by our suppliers (which we have agreed to make available to you).</p>
      <p class="tnc-p">3.3&nbsp;&nbsp;You agree that we (including our agents and employees) have not made any representation to you other than matters expressly set out in this Agreement and any Order Form.</p>
      <p class="tnc-p">3.4&nbsp;&nbsp;You warrant that you have considered your own circumstances and you have decided that the Products are fit for the intended purpose and, where required, obtained professional advice before making your order.</p>
      <p class="tnc-p">3.5&nbsp;&nbsp;For the avoidance of doubt, you agree that we have made absolutely no representation that the Products are suitable for any purpose and even where we have made any such representation to you, you have not relied on this representation whatsoever.</p>
      <p class="tnc-p">3.6&nbsp;&nbsp;Due to the variability in the manufacturing process of tiles which cannot be avoided, Products are subject to variability in colour, shade, dimensions, texture, calibre and finish and you acknowledge that the delivered Products may vary from any display samples provided to you. In addition, Product may react to their environment and may change overtime. You agree to accept reasonable variances in Products (in accordance with generally accepted industry standards) and that such variances will not constitute defects.</p>
      <p class="tnc-p">3.7&nbsp;&nbsp;To the extent permitted by law, you agree that we are not liable for any loss you may suffer (including indirect loss) in connection with any variance which is of the same nature as those described in clause 3.6.</p>
      <p class="tnc-p">3.8&nbsp;&nbsp;You agree to inspect the Products and notify us of any discrepancies or defects in the Products or your order. Without limiting any remedy you may be entitled to under Australian consumer law, you agree that we are not be liable to you or any other person for any defect or discrepancy in your order or the Product unless notice is given to us within 3 Business Days of delivery.</p>
      <p class="tnc-p">3.9&nbsp;&nbsp;You may decide to collect, or arrange for your own delivery of, your order from us. In this circumstance, we will be considered to have delivered your order on the Products being collected from us and you agree that risk in the Products passes to you at this time.</p>
      <p class="tnc-p">3.10&nbsp;Your order will not be made available or delivered to you until you pay all Amounts Outstanding to us unless agreed otherwise.</p>

      <div class="tnc-clause-title">4&nbsp;&nbsp;Delivery of your order</div>
      <p class="tnc-p">4.1&nbsp;&nbsp;This clause 4 applies where we have agreed to deliver Products to you.</p>
      <p class="tnc-p">4.2&nbsp;&nbsp;We will provide you with notice when your order is available for delivery (Order Availability).</p>
      <p class="tnc-p">4.3&nbsp;&nbsp;On your payment to us of all Amounts Outstanding, we agree to promptly deliver your order to the location set out in an Order Form (or otherwise agreed in writing).</p>
      <p class="tnc-p">4.4&nbsp;&nbsp;Fees for delivery will be agreed at the time you request delivery of the Products based on distance, order size and delivery requirements.</p>
      <p class="tnc-p">4.5&nbsp;&nbsp;We typically deliver Products by commercial freight, on a securely packaged pallet. You acknowledge that the delivery location must be accessible by delivery trucks and forklifts.</p>
      <p class="tnc-p">4.6&nbsp;&nbsp;You warrant, and agree to ensure, that the nominated delivery address is safe and suitable to accept delivery including by having sufficient space and adequate access for unloading and storage of the Products.</p>
      <p class="tnc-p">4.7&nbsp;&nbsp;In the absence of any agreed specific delivery instructions, you agree that we may place the delivered Products at any reasonably safe location at the delivery address.</p>
      <p class="tnc-p">4.8&nbsp;&nbsp;You agree that risk in the Products passes to you on our delivering the Products to the delivery address.</p>
      <p class="tnc-p">4.9&nbsp;&nbsp;To the extent permitted by law, you agree that we have no liability to you or any other person where we act in accordance with your delivery instructions including by placing the Products at a reasonably safe location in accordance with clause 4.7.</p>

      <div class="tnc-clause-title">5&nbsp;&nbsp;Additional expenses</div>
      <p class="tnc-p">5.1&nbsp;&nbsp;We will use our best endeavours to coordinate prompt delivery of your order in accordance with your instructions. However, you acknowledge that delivery of your order may be delayed, blocked or refused due to a range of circumstances including if we do not receive your full payment of any Amounts Outstanding; inadequate delivery location or instructions; lack of available transport or drivers; or hazardous or potentially damaging conditions.</p>
      <p class="tnc-p">5.2&nbsp;&nbsp;You agree that we have no liability to you or any other person where delivery of your order is delayed.</p>
      <p class="tnc-p">5.3&nbsp;&nbsp;You agree to reimburse us for any expense we may incur in connection with storing the Products as and from the date of Order Availability including for failed delivery and you agree we may charge you a re-delivery fee (Storage and Failed Delivery Expenses). You agree that we have the absolute discretion to incur all reasonable Storage and Failed Delivery Expenses. You agree that Storage and Failed Delivery Expenses will form part of Amounts Outstanding.</p>

      <div class="tnc-clause-title">6&nbsp;&nbsp;Fees and payment</div>
      <p class="tnc-p">6.1&nbsp;&nbsp;Unless the payment terms set out in a Purchase Order Form state otherwise: (a) All amounts payable under an order are payable on the date of the order. (b) Any Deposit falls due on the date you place an order. (c) The balance payable under your order falls due on the latter of: (i) 30 days from the date you place an order; and (ii) the date of Order Availability.</p>
      <p class="tnc-p">6.2&nbsp;&nbsp;The parties may agree payment terms which differ from clause 6.1 in an Order Form.</p>
      <p class="tnc-p">6.3&nbsp;&nbsp;Storage and Failed Delivery Expenses are immediate due and payable.</p>
      <p class="tnc-p">6.4&nbsp;&nbsp;All amounts owing under this Agreement must be paid to the following bank account: Account name: AMP Tiles Pty Ltd &nbsp;|&nbsp; Account number: 267221347 &nbsp;|&nbsp; BSB: 082356 &nbsp;|&nbsp; Reference: Please include your customer name as reference for the funds transfer.</p>
      <p class="tnc-p">6.5&nbsp;&nbsp;You acknowledge the cyber security risk of invoice fraud and agree that any change to the details of our bank account is only effective following: (a) written notice by us of the change of bank account details; and (b) you completing a call-back to our ordinary phone number and confirming that the change of bank account details is true and correct.</p>
      <p class="tnc-p">6.6&nbsp;&nbsp;Interest on overdue payments under this Agreement accrues at the prevailing pre-judgement penalty interest rate applicable in the Local Court of New South Wales (7.6% per annum as at the date of this Agreement).</p>
      <p class="tnc-p">6.7&nbsp;&nbsp;Where GST is applicable, any amounts payable under this Agreement: (a) you must pay us the applicable GST; and (b) we must provide you with a valid tax invoice.</p>
      <p class="tnc-p">6.8&nbsp;&nbsp;For the avoidance of doubt, unless stated otherwise, any amounts stated in this Agreement are GST exclusive.</p>

      <div class="tnc-clause-title">7&nbsp;&nbsp;Liability and indemnity</div>
      <p class="tnc-p">7.1&nbsp;&nbsp;To the extent permitted by law, you agree that our liability to you for any loss, damage, cost, expense or liability incurred in connection with this Agreement is limited to amounts paid by you under this Agreement.</p>
      <p class="tnc-p">7.2&nbsp;&nbsp;To the extent permitted by law you agree that our liability is further limited and we have no liability to you whatsoever for any loss, damage, cost, expense or liability incurred in connection with this Agreement in relation to the quality or performance of the Products.</p>
      <p class="tnc-p">7.3&nbsp;&nbsp;To the extent permitted by law, you indemnify us from and against all liability, losses, damages, costs and expenses (including legal expenses) arising directly or indirectly to any third party as a result of or in connection with: (a) our delivery of the Product in accordance with your directions; (b) your or any third party's use of the Product; or (c) any defect in the Product.</p>

      <div class="tnc-clause-title">8&nbsp;&nbsp;General</div>
      <p class="tnc-p">8.1&nbsp;&nbsp;You must promptly take all action necessary or desirable to effect, perfect or complete the transactions contemplated by this Agreement including your order and Delivery.</p>
      <p class="tnc-p">8.2&nbsp;&nbsp;You agree that we may vary this Agreement with 10 business days&#39; written notice to you. You are deemed to agree with any such variation on expiry of such notice period.</p>
      <p class="tnc-p">8.3&nbsp;&nbsp;The terms of this Agreement are governed by and construed under the laws of the state of New South Wales, Australia. Each party irrevocably submits to the exclusive jurisdiction of the courts in the state of New South Wales, Australia in relation to any legal action or proceedings arising out of or in connection with this Agreement.</p>
      <p class="tnc-p">8.4&nbsp;&nbsp;All notices under this Agreement must be in writing, addressed to the recipient and delivered to the recipient&#39;s usual address or email address.</p>

      <div class="tnc-clause-title">9&nbsp;&nbsp;Defined terms</div>
      <p class="tnc-p">9.1&nbsp;&nbsp;<strong>Amounts Outstanding</strong> means any amounts which are due and payable by you for Products under this Agreement.</p>
      <p class="tnc-p">9.2&nbsp;&nbsp;<strong>Business Day</strong> means any day on which banks in the State of New South Wales are open for general banking business, other than a Saturday, Sunday or public holiday in the State.</p>
    </div>

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
