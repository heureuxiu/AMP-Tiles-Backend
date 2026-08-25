const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);

// Support both project-root .cache and HOME-based cache (Render sets HOME=/opt/render)
const DEFAULT_CACHE_DIR =
  process.env.PUPPETEER_CACHE_DIR ||
  path.resolve(__dirname, '../../.cache/puppeteer');
const INSTALL_TIMEOUT_MS = 5 * 60 * 1000;
const INSTALL_MAX_BUFFER = 10 * 1024 * 1024;

let installPromise = null;
let browserPromise = null;

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

// Comprehensive args for headless Chrome on cloud/container environments
// (Render, Railway, Heroku, AWS EB, Docker, etc.)
const CHROME_ARGS = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--disable-gpu',
  '--no-zygote',
  '--single-process',
  '--disable-extensions',
  '--disable-software-rasterizer',
  '--disable-background-networking',
  '--disable-default-apps',
  '--disable-sync',
  '--disable-translate',
  '--hide-scrollbars',
  '--metrics-recording-only',
  '--mute-audio',
  '--no-first-run',
  '--safebrowsing-disable-auto-update',
];

function getLaunchOptions(puppeteer, executablePath) {
  const options = {
    headless: 'new',
    args: CHROME_ARGS,
  };

  // 1. Explicit env override (highest priority)
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

  // 3. Puppeteer bundled browser — try executablePath() first
  if (typeof puppeteer.executablePath === 'function') {
    try {
      const detectedPath = puppeteer.executablePath();
      if (detectedPath && fs.existsSync(detectedPath)) {
        options.executablePath = detectedPath;
        return options;
      }
    } catch (_) {}
  }

  // 4. Try to locate Chrome in the puppeteer cache directory explicitly
  try {
    const cacheDir = getCacheDir();
    // puppeteer v20+ stores chrome in <cacheDir>/chrome/<platform>-<revision>/
    if (fs.existsSync(cacheDir)) {
      const chromeDirs = fs.readdirSync(cacheDir).filter((d) => d.startsWith('chrome'));
      for (const dir of chromeDirs) {
        const sub = path.join(cacheDir, dir);
        const revDirs = fs.existsSync(sub) ? fs.readdirSync(sub) : [];
        for (const rev of revDirs) {
          const candidates = [
            path.join(sub, rev, 'chrome-linux64', 'chrome'),
            path.join(sub, rev, 'chrome-linux', 'chrome'),
            path.join(sub, rev, 'chrome'),
          ];
          for (const c of candidates) {
            if (fs.existsSync(c)) {
              options.executablePath = c;
              return options;
            }
          }
        }
      }
    }
  } catch (_) {}

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

async function getReusablePuppeteerBrowser(puppeteer) {
  if (browserPromise) {
    try {
      const browser = await browserPromise;
      if (browser?.isConnected?.()) return browser;
    } catch (_) {
      browserPromise = null;
    }
  }

  browserPromise = launchPuppeteerBrowser(puppeteer).catch((error) => {
    browserPromise = null;
    throw error;
  });

  const browser = await browserPromise;
  browser.on('disconnected', () => {
    browserPromise = null;
  });
  return browser;
}

async function closeReusablePuppeteerBrowser() {
  if (!browserPromise) return;

  const browser = await browserPromise.catch(() => null);
  browserPromise = null;
  if (browser?.isConnected?.()) {
    await browser.close();
  }
}

module.exports = {
  getPuppeteer,
  launchPuppeteerBrowser,
  getReusablePuppeteerBrowser,
  closeReusablePuppeteerBrowser,
};
