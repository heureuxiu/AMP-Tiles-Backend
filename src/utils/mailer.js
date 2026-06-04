const axios = require('axios');

function getEmailConfig() {
  return {
    provider: process.env.EMAIL_PROVIDER || 'brevo',
    apiKey: process.env.BREVO_API_KEY,

    fromEmail: process.env.SMTP_FROM_EMAIL || 'info@devforc.com',
    fromName: process.env.SMTP_FROM_NAME || 'AMP Tiles',
    replyTo:
      process.env.SMTP_REPLY_TO ||
      process.env.SMTP_FROM_EMAIL ||
      'info@devforc.com',
  };
}

function isMailerConfigured() {
  const cfg = getEmailConfig();

  return Boolean(
    cfg.provider === 'brevo' &&
      cfg.apiKey &&
      cfg.fromEmail
  );
}

async function verifyMailer() {
  if (!isMailerConfigured()) {
    throw new Error(
      'Brevo email service is not configured. Please set EMAIL_PROVIDER=brevo, BREVO_API_KEY and SMTP_FROM_EMAIL.'
    );
  }

  console.log('Brevo email service is configured.');
  return true;
}

function normalizeRecipients(value) {
  if (!value) return undefined;

  if (Array.isArray(value)) {
    return value
      .filter(Boolean)
      .map((item) => {
        if (typeof item === 'string') {
          return { email: item };
        }

        return item;
      });
  }

  if (typeof value === 'string') {
    return value
      .split(',')
      .map((email) => email.trim())
      .filter(Boolean)
      .map((email) => ({
        email,
      }));
  }

  return undefined;
}

function normalizeAttachments(attachments) {
  if (!Array.isArray(attachments) || attachments.length === 0) {
    return undefined;
  }

  return attachments
    .map((file) => {
      if (!file) return null;

      return {
        name: file.filename || file.name,
        content: file.content,
      };
    })
    .filter(Boolean);
}

async function sendEmail({
  to,
  cc,
  bcc,
  subject,
  text,
  html,
  attachments,
  replyTo,
}) {
  const cfg = getEmailConfig();

  if (!isMailerConfigured()) {
    throw new Error(
      'Brevo email service is not configured.'
    );
  }

  const toRecipients = normalizeRecipients(to);

  if (!toRecipients || toRecipients.length === 0) {
    throw new Error('Recipient email is required.');
  }

  const payload = {
    sender: {
      name: cfg.fromName,
      email: cfg.fromEmail,
    },

    to: toRecipients,

    subject,

    replyTo: {
      email: replyTo || cfg.replyTo,
    },
  };

  if (text) {
    payload.textContent = text;
  }

  if (html) {
    payload.htmlContent = html;
  }

  const ccRecipients = normalizeRecipients(cc);

  if (ccRecipients?.length) {
    payload.cc = ccRecipients;
  }

  const bccRecipients = normalizeRecipients(bcc);

  if (bccRecipients?.length) {
    payload.bcc = bccRecipients;
  }

  const normalizedAttachments =
    normalizeAttachments(attachments);

  if (normalizedAttachments?.length) {
    payload.attachment = normalizedAttachments;
  }

  try {
    const response = await axios.post(
      'https://api.brevo.com/v3/smtp/email',
      payload,
      {
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          'api-key': cfg.apiKey,
        },
        timeout: 30000,
      }
    );

    console.log(
      'Email sent successfully via Brevo:',
      response.data
    );

    return response.data;
  } catch (error) {
    const brevoError = error.response?.data;

    console.error('==============================');
    console.error('BREVO ERROR');
    console.error('Status:', error.response?.status);
    console.error('Response:', brevoError);
    console.error('Message:', error.message);
    console.error('==============================');

    throw new Error(
      brevoError?.message ||
        brevoError?.code ||
        error.message
    );
  }
}

module.exports = {
  isMailerConfigured,
  verifyMailer,
  sendEmail,
};
