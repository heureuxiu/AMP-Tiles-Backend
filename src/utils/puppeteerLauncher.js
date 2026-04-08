const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

const DEFAULT_CACHE_DIR = path.resolve(__dirname, '../../.cache/puppeteer');
const INSTALL_TIMEOUT_MS = 5 * 60 * 1000;
const INSTALL_MAX_BUFFER = 10 * 1024 * 1024;

let installPromise = null;

function getPuppeteer() {
  try {
    return require('puppeteer');
  } catch (error) {
    throw new Error(
      'puppeteer is not installed. Run: npm install puppeteer (in the server folder, with dev server stopped)'
    );
  }
}

function getCacheDir() {
  return process.env.PUPPETEER_CACHE_DIR || DEFAULT_CACHE_DIR;
}

function withCacheDirEnv() {
  return {
    ...process.env,
    PUPPETEER_CACHE_DIR: getCacheDir(),
  };
}

function getLaunchOptions(puppeteer) {
  const options = {
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  };

  const explicitPath =
    process.env.PUPPETEER_EXECUTABLE_PATH || process.env.CHROME_PATH || '';
  if (explicitPath) {
    options.executablePath = explicitPath;
    return options;
  }

  if (typeof puppeteer.executablePath === 'function') {
    try {
      const detectedPath = puppeteer.executablePath();
      if (detectedPath) options.executablePath = detectedPath;
    } catch (_) {
      // Ignore; Puppeteer will throw a clearer missing-browser error on launch.
    }
  }

  return options;
}

function isMissingBrowserError(error) {
  const msg = String(error?.message || '');
  return (
    msg.includes('Could not find Chrome') ||
    msg.includes('Could not find Chromium') ||
    msg.includes('Could not find expected browser') ||
    msg.includes('Browser was not found')
  );
}

async function installChromeBrowser() {
  if (installPromise) return installPromise;

  installPromise = (async () => {
    const cacheDir = getCacheDir();
    await fs.promises.mkdir(cacheDir, { recursive: true });

    const npxCommand = process.platform === 'win32' ? 'npx.cmd' : 'npx';
    const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const cwd = path.resolve(__dirname, '../..');
    const commonOptions = {
      cwd,
      env: withCacheDirEnv(),
      timeout: INSTALL_TIMEOUT_MS,
      maxBuffer: INSTALL_MAX_BUFFER,
    };

    try {
      return await execFileAsync(npxCommand, ['puppeteer', 'browsers', 'install', 'chrome'], commonOptions);
    } catch (firstError) {
      // Some platforms/services do not provide npx in PATH during runtime; fallback to npm exec.
      try {
        return await execFileAsync(
          npmCommand,
          ['exec', 'puppeteer', 'browsers', 'install', 'chrome'],
          commonOptions
        );
      } catch (secondError) {
        secondError.message = `${firstError.message} | ${secondError.message}`;
        throw secondError;
      }
    }
  })().finally(() => {
    installPromise = null;
  });

  return installPromise;
}

async function launchPuppeteerBrowser(puppeteer) {
  const firstLaunchOptions = getLaunchOptions(puppeteer);
  try {
    return await puppeteer.launch(firstLaunchOptions);
  } catch (error) {
    if (!isMissingBrowserError(error)) throw error;

    try {
      await installChromeBrowser();
    } catch (installError) {
      const details = [
        installError?.message || '',
        installError?.stderr ? String(installError.stderr).trim() : '',
      ]
        .filter(Boolean)
        .join(' | ');

      throw new Error(
        `Chrome browser is missing for Puppeteer and auto-install failed. ${details || 'Please run "npx puppeteer browsers install chrome" in the server folder and redeploy.'}`
      );
    }

    const retryLaunchOptions = getLaunchOptions(puppeteer);
    return puppeteer.launch(retryLaunchOptions);
  }
}

module.exports = {
  getPuppeteer,
  launchPuppeteerBrowser,
};
