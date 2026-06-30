const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

const UPLOAD_ROOT = path.join(__dirname, '../../uploads/email-attachments');
const PUBLIC_UPLOAD_PREFIX = '/uploads/email-attachments';

async function ensureUploadDir() {
  await fs.mkdir(UPLOAD_ROOT, { recursive: true });
}

async function saveUploadedAttachments(files = []) {
  if (!Array.isArray(files) || files.length === 0) return [];

  await ensureUploadDir();

  const saved = [];
  for (const file of files) {
    const extension = path.extname(file.originalname || '');
    const storedName = `${Date.now()}-${crypto.randomUUID()}${extension}`;
    const filePath = path.join(UPLOAD_ROOT, storedName);
    // eslint-disable-next-line no-await-in-loop
    await fs.writeFile(filePath, file.buffer);
    saved.push({
      originalName: file.originalname,
      storedName,
      mimeType: file.mimetype,
      size: file.size,
      url: `${PUBLIC_UPLOAD_PREFIX}/${storedName}`,
      uploadedAt: new Date(),
    });
  }

  return saved;
}

async function removeStoredAttachments(attachments = []) {
  if (!Array.isArray(attachments) || attachments.length === 0) return;

  for (const attachment of attachments) {
    const storedName = attachment?.storedName;
    if (!storedName) continue;

    const filePath = path.join(UPLOAD_ROOT, storedName);
    try {
      // eslint-disable-next-line no-await-in-loop
      await fs.unlink(filePath);
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        // eslint-disable-next-line no-console
        console.error('Failed to delete stored attachment:', filePath, error.message);
      }
    }
  }
}

async function buildStoredEmailAttachments(attachments = []) {
  if (!Array.isArray(attachments) || attachments.length === 0) return [];

  const built = [];
  for (const attachment of attachments) {
    const storedName = attachment?.storedName;
    if (!storedName) continue;

    try {
      const filePath = path.join(UPLOAD_ROOT, storedName);
      // eslint-disable-next-line no-await-in-loop
      const content = await fs.readFile(filePath);
      built.push({
        filename: attachment.originalName || storedName,
        content,
        contentType: attachment.mimeType || undefined,
      });
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('Failed to read stored attachment:', storedName, error.message);
    }
  }

  return built;
}

module.exports = {
  saveUploadedAttachments,
  removeStoredAttachments,
  buildStoredEmailAttachments,
};
