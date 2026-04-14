const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);

const DEFAULT_CACHE_DIR = path.resolve(__dirname, '../../.cache/puppeteer');
const INSTALL_TIMEOUT_MS = 5 * 60 * 1000;
const INSTALL_MAX_BUFFER = 10 * 1024 * 1024;

let installPromise = null;

// Known system Chrome paths per platform
const SYSTEM_CHROME_PATHS = {
  win32: [
    process.env.LOCALAPPDATA
      ? path.join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe')
      : null,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ].filter(Boolean),
  darwin: [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
  ],
  linux: [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
  ],
};

function findSystemChrome() {
  const candidates = SYSTEM_CHROME_PATHS[process.platform] || [];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return p;
    } catch (_) {}
  }
  return null;
}

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

function getLaunchOptions(puppeteer, executablePath) {
  const options = {
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  };

  // 1. Explicit env override
  const envPath = process.env.PUPPETEER_EXECUTABLE_PATH || process.env.CHROME_PATH || '';
  if (envPath) {
    options.executablePath = envPath;
    return options;
  }

  // 2. Caller-supplied path (e.g. system Chrome found above)
  if (executablePath) {
    options.executablePath = executablePath;
    return options;
  }

  // 3. Puppeteer bundled browser path
  if (typeof puppeteer.executablePath === 'function') {
    try {
      const detectedPath = puppeteer.executablePath();
      if (detectedPath) options.executablePath = detectedPath;
    } catch (_) {}
  }

  return options;
}

function isMissingBrowserError(error) {
  const msg = String(error?.message || error || '');
  return (
    msg.includes('Could not find Chrome') ||
    msg.includes('Could not find Chromium') ||
    msg.includes('Could not find expected browser') ||
    msg.includes('Browser was not found') ||
    msg.includes('Failed to launch') ||
    msg.includes('ENOENT')
  );
}

async function installChromeBrowser() {
  if (installPromise) return installPromise;

  installPromise = (async () => {
    const cacheDir = getCacheDir();
    await fs.promises.mkdir(cacheDir, { recursive: true });

    const cwd = path.resolve(__dirname, '../..');
    const commonOptions = {
      cwd,
      env: withCacheDirEnv(),
      timeout: INSTALL_TIMEOUT_MS,
      maxBuffer: INSTALL_MAX_BUFFER,
      // shell:true is required on Windows to run .cmd wrappers (npx.cmd / npm.cmd)
      shell: true,
    };

    try {
      return await execAsync('npx puppeteer browsers install chrome', commonOptions);
    } catch (firstError) {
      try {
        return await execAsync('npm exec -- puppeteer browsers install chrome', commonOptions);
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
  // Try system Chrome first — avoids the need for a bundled browser entirely
  const systemChrome = findSystemChrome();
  if (systemChrome) {
    try {
      return await puppeteer.launch(getLaunchOptions(puppeteer, systemChrome));
    } catch (_) {
      // Fall through to bundled / install path
    }
  }

  // Try puppeteer's bundled browser
  try {
    return await puppeteer.launch(getLaunchOptions(puppeteer));
  } catch (error) {
    if (!isMissingBrowserError(error)) throw error;

    // Auto-install bundled browser
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
        `Chrome browser is missing for Puppeteer and auto-install failed. ${details || 'Please run "npx puppeteer browsers install chrome" in the server folder.'}`
      );
    }

    return puppeteer.launch(getLaunchOptions(puppeteer));
  }
}

module.exports = {
  getPuppeteer,
  launchPuppeteerBrowser,
};
