function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatDate(value) {
  if (!value) return 'N/A';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'N/A';
  return date.toLocaleDateString('en-AU', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function formatCurrency(amount) {
  const num = Number(amount) || 0;
  return new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: 'AUD',
  }).format(num);
}

function formatQuantity(value) {
  const numeric = Number(value) || 0;
  const rounded = Math.round(numeric * 1000) / 1000;
  if (Number.isInteger(rounded)) return String(rounded);
  return rounded.toFixed(3).replace(/\.?0+$/, '');
}

const SQFT_PER_SQM = 10.764;

const DEFAULT_DELIVERY_COST = 0;
const COMPANY_DETAILS = {
  name: 'AMP TILES PTY LTD',
  abn: '14 690 181 858',
  address: 'Unit 15/55 Anderson Road, Smeaton Grange, NSW 2560',
};
const BANK_DETAILS = {
  bank: 'NAB',
  accountName: 'AMP TILES PTY LTD',
  bsb: '082-356',
  accountNumber: '26-722-1347',
};

function getQuotationAmountSnapshot(quotation) {
  const subtotal = Number(quotation?.subtotal) || 0;
  const discount = Number(quotation?.discount) || 0;
  const tax = Number(quotation?.tax) || 0;
  const baseTotal = subtotal - discount + tax;
  const parsedDelivery = Number(quotation?.deliveryCost);
  const fallbackDelivery = Math.max(0, Math.round((Number(quotation?.grandTotal) - baseTotal) * 100) / 100);
  const deliveryCost = Number.isFinite(parsedDelivery)
    ? Math.max(0, parsedDelivery)
    : Number.isFinite(fallbackDelivery)
      ? fallbackDelivery
      : DEFAULT_DELIVERY_COST;
  const grandTotal = Number.isFinite(Number(quotation?.grandTotal))
    ? Number(quotation.grandTotal)
    : baseTotal + deliveryCost;

  return {
    subtotal: Math.round(subtotal * 100) / 100,
    discount: Math.round(discount * 100) / 100,
    tax: Math.round(tax * 100) / 100,
    deliveryCost: Math.round(deliveryCost * 100) / 100,
    grandTotal: Math.round(grandTotal * 100) / 100,
  };
}

function getDeliveryAddress(source) {
  return String(source?.deliveryAddress || source?.customerAddress || '').trim();
}

function getQuotationItemDetails(item) {
  const product =
    item && item.product && typeof item.product === 'object' ? item.product : null;
  const productName = item?.productName || product?.name || 'Product';
  const skuRaw = item?.sku ?? product?.sku;
  const descriptionRaw = item?.description ?? product?.description;
  const sizeRaw = product?.size ?? item?.size;
  const unitType = String(item?.unitType || '');
  const normalizedUnit = unitType.toLowerCase();
  const coverageSqm = Number(item?.coverageSqm);
  let displayQuantity = formatQuantity(item?.quantity);
  if (Number.isFinite(coverageSqm) && coverageSqm > 0) {
    if (
      normalizedUnit.includes('sqft') ||
      normalizedUnit.includes('sq ft') ||
      normalizedUnit.includes('sqfeet')
    ) {
      displayQuantity = formatQuantity(coverageSqm * SQFT_PER_SQM);
    } else if (
      normalizedUnit.includes('sqm') ||
      normalizedUnit.includes('sq meter') ||
      normalizedUnit.includes('sqmetre')
    ) {
      displayQuantity = formatQuantity(coverageSqm);
    }
  }

  return {
    productName,
    sku: skuRaw ? String(skuRaw) : 'N/A',
    description: descriptionRaw ? String(descriptionRaw) : 'N/A',
    size: sizeRaw ? String(sizeRaw) : 'N/A',
    unit: unitType || 'N/A',
    quantity: displayQuantity,
    rate: Number(item?.rate) || 0,
    amount: Number(item?.lineTotal) || 0,
  };
}

function buildQuotationEmail(quotation) {
  const quoteNo = quotation.quotationNumber || String(quotation._id || '');
  const customerName = quotation.customerName || 'Customer';
  const deliveryAddress = getDeliveryAddress(quotation);
  const quoteDate = formatDate(quotation.quotationDate);
  const validUntil = quotation.validUntil ? formatDate(quotation.validUntil) : 'N/A';
  const amounts = getQuotationAmountSnapshot(quotation);
  const grandTotal = formatCurrency(amounts.grandTotal);

  const rowsHtml = (quotation.items || [])
    .map((item) => {
      const details = getQuotationItemDetails(item);
      return `<tr>
        <td style="padding:8px;border:1px solid #ddd;">${escapeHtml(details.productName)}</td>
        <td style="padding:8px;border:1px solid #ddd;">${escapeHtml(details.sku)}</td>
        <td style="padding:8px;border:1px solid #ddd;">${escapeHtml(details.description)}</td>
        <td style="padding:8px;border:1px solid #ddd;">${escapeHtml(details.size)}</td>
        <td style="padding:8px;border:1px solid #ddd;">${escapeHtml(details.unit)}</td>
        <td style="padding:8px;border:1px solid #ddd;text-align:right;">${details.quantity}</td>
        <td style="padding:8px;border:1px solid #ddd;text-align:right;">${formatCurrency(details.rate)}</td>
        <td style="padding:8px;border:1px solid #ddd;text-align:right;">${formatCurrency(details.amount)}</td>
      </tr>`;
    })
    .join('');
  const totalsRowsHtml = [
    `<tr>
      <td colspan="7" style="padding:8px;border:1px solid #ddd;text-align:right;font-weight:600;">Subtotal</td>
      <td style="padding:8px;border:1px solid #ddd;text-align:right;font-weight:600;">${escapeHtml(formatCurrency(amounts.subtotal))}</td>
    </tr>`,
    amounts.discount > 0
      ? `<tr>
          <td colspan="7" style="padding:8px;border:1px solid #ddd;text-align:right;font-weight:600;">Discount</td>
          <td style="padding:8px;border:1px solid #ddd;text-align:right;font-weight:600;">-${escapeHtml(formatCurrency(amounts.discount))}</td>
        </tr>`
      : '',
    `<tr>
      <td colspan="7" style="padding:8px;border:1px solid #ddd;text-align:right;font-weight:600;">Tax (GST)</td>
      <td style="padding:8px;border:1px solid #ddd;text-align:right;font-weight:600;">${escapeHtml(formatCurrency(amounts.tax))}</td>
    </tr>`,
    `<tr>
      <td colspan="7" style="padding:8px;border:1px solid #ddd;text-align:right;font-weight:600;">Delivery Cost</td>
      <td style="padding:8px;border:1px solid #ddd;text-align:right;font-weight:600;">${escapeHtml(formatCurrency(amounts.deliveryCost))}</td>
    </tr>`,
    `<tr>
      <td colspan="7" style="padding:8px;border:1px solid #ddd;text-align:right;font-weight:700;">Grand Total</td>
      <td style="padding:8px;border:1px solid #ddd;text-align:right;font-weight:700;">${escapeHtml(grandTotal)}</td>
    </tr>`,
  ]
    .filter(Boolean)
    .join('');

  const notesLine = quotation.notes ? `\nNotes: ${quotation.notes}` : '';
  const termsLine = quotation.terms ? `\nTerms: ${quotation.terms}` : '';

  const text = [
    `Quotation ${quoteNo}`,
    `Dear ${customerName},`,
    '',
    'Please find your quotation details below.',
    '',
    `Quotation Date: ${quoteDate}`,
    `Valid Until: ${validUntil}`,
    deliveryAddress ? `Delivery Address: ${deliveryAddress}` : '',
    `Subtotal: ${formatCurrency(amounts.subtotal)}`,
    amounts.discount > 0 ? `Discount: -${formatCurrency(amounts.discount)}` : '',
    amounts.tax > 0 ? `Tax (GST): ${formatCurrency(amounts.tax)}` : '',
    `Delivery Cost: ${formatCurrency(amounts.deliveryCost)}`,
    `Grand Total: ${grandTotal}`,
    '',
    'Items:',
    ...(quotation.items || []).map((item) => {
      const details = getQuotationItemDetails(item);
      return `- ${details.productName} | SKU: ${details.sku} | Desc: ${details.description} | Size: ${details.size} | Unit: ${details.unit} | Qty: ${details.quantity} | Rate: ${formatCurrency(details.rate)} | Amount: ${formatCurrency(details.amount)}`;
    }),
    '',
    'Please see attached quotation PDF for your records.',
    '',
    notesLine,
    termsLine,
    '',
    `${COMPANY_DETAILS.name}`,
    `ABN: ${COMPANY_DETAILS.abn}`,
    `Address: ${COMPANY_DETAILS.address}`,
    `Bank: ${BANK_DETAILS.bank}`,
    `Account Name: ${BANK_DETAILS.accountName}`,
    `BSB: ${BANK_DETAILS.bsb}`,
    `Account Number: ${BANK_DETAILS.accountNumber}`,
    '',
    'Thank you,',
    COMPANY_DETAILS.name,
  ]
    .filter(Boolean)
    .join('\n');

  const html = `
    <div style="font-family: Arial, sans-serif; color: #111827; line-height: 1.4;">
      <h2 style="margin:0 0 16px;">Quotation ${escapeHtml(quoteNo)}</h2>
      <p>Dear ${escapeHtml(customerName)},</p>
      <p>Please find your quotation details below.</p>
      <p>
        <strong>Quotation Date:</strong> ${escapeHtml(quoteDate)}<br/>
        <strong>Valid Until:</strong> ${escapeHtml(validUntil)}<br/>
        ${
          deliveryAddress
            ? `<strong>Delivery Address:</strong> ${escapeHtml(deliveryAddress)}<br/>`
            : ''
        }
        <strong>Subtotal:</strong> ${escapeHtml(formatCurrency(amounts.subtotal))}<br/>
        ${
          amounts.discount > 0
            ? `<strong>Discount:</strong> -${escapeHtml(formatCurrency(amounts.discount))}<br/>`
            : ''
        }
        ${
          amounts.tax > 0
            ? `<strong>Tax (GST):</strong> ${escapeHtml(formatCurrency(amounts.tax))}<br/>`
            : ''
        }
        <strong>Delivery Cost:</strong> ${escapeHtml(formatCurrency(amounts.deliveryCost))}<br/>
        <strong>Grand Total:</strong> ${escapeHtml(grandTotal)}
      </p>

      <table style="width:100%;border-collapse:collapse;margin:16px 0;">
        <thead>
          <tr>
            <th style="padding:8px;border:1px solid #ddd;text-align:left;">Product</th>
            <th style="padding:8px;border:1px solid #ddd;text-align:left;">SKU</th>
            <th style="padding:8px;border:1px solid #ddd;text-align:left;">Description</th>
            <th style="padding:8px;border:1px solid #ddd;text-align:left;">Size</th>
            <th style="padding:8px;border:1px solid #ddd;text-align:left;">Unit</th>
            <th style="padding:8px;border:1px solid #ddd;text-align:right;">Piece</th>
            <th style="padding:8px;border:1px solid #ddd;text-align:right;">Rate</th>
            <th style="padding:8px;border:1px solid #ddd;text-align:right;">Amount</th>
          </tr>
        </thead>
        <tbody>${rowsHtml}${totalsRowsHtml}</tbody>
      </table>

      ${
        quotation.notes
          ? `<p><strong>Notes:</strong> ${escapeHtml(quotation.notes)}</p>`
          : ''
      }
      ${
        quotation.terms
          ? `<p><strong>Terms:</strong> ${escapeHtml(quotation.terms)}</p>`
          : ''
      }

      <p style="margin-top:20px;">
        <strong>${escapeHtml(COMPANY_DETAILS.name)}</strong><br/>
        ABN: ${escapeHtml(COMPANY_DETAILS.abn)}<br/>
        ${escapeHtml(COMPANY_DETAILS.address)}
      </p>

      <p style="margin-top:12px;">
        <strong>Bank Details</strong><br/>
        Bank: ${escapeHtml(BANK_DETAILS.bank)}<br/>
        Account Name: ${escapeHtml(BANK_DETAILS.accountName)}<br/>
        BSB: ${escapeHtml(BANK_DETAILS.bsb)}<br/>
        Account Number: ${escapeHtml(BANK_DETAILS.accountNumber)}
      </p>

      <p style="margin-top:24px;">Thank you,<br/>${escapeHtml(COMPANY_DETAILS.name)}</p>
    </div>
  `;

  return {
    subject: `Quotation ${quoteNo} from ${COMPANY_DETAILS.name}`,
    text,
    html,
  };
}

module.exports = {
  buildQuotationEmail,
};


