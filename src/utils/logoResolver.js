const fs = require('fs');
const path = require('path');

function getLogoCandidates() {
  const fromEnv = process.env.PDF_LOGO_PATH;

  return [
    fromEnv,
    path.resolve(process.cwd(), 'AMP-TILES-LOGO.png'),
    path.resolve(__dirname, '../assets/AMP-TILES-LOGO.png'),
    path.resolve(__dirname, '../../AMP-TILES-LOGO.png'),
  ].filter(Boolean);
}

function readLogoBase64() {
  const candidates = getLogoCandidates();

  for (const logoPath of candidates) {
    try {
      if (!fs.existsSync(logoPath)) continue;
      const logoBuffer = fs.readFileSync(logoPath);
      return `data:image/png;base64,${logoBuffer.toString('base64')}`;
    } catch (error) {
      // Try the next candidate path.
    }
  }

  return '';
}

module.exports = {
  readLogoBase64,
};
