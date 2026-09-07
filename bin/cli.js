#!/usr/bin/env node

/**
 * ==============================================================================
 * ✨ Rastin RTL - 100% Automated 1-Command Installer & Activator
 * CLI runner for: npx rastin-rtl / npx antigravity-rtl
 * Author: Ali Naghinezhad (Mancity1383)
 * ==============================================================================
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import { spawn, execSync } from 'child_process';
import https from 'https';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Terminal ANSI colors
const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  white: '\x1b[37m',
  brightCyan: '\x1b[96m',
  brightGreen: '\x1b[92m'
};

console.log('');
console.log(`${c.cyan}  ====================================================================${c.reset}`);
console.log(`${c.bold}${c.brightGreen}     ✨ راستین RTL (Rastin RTL) - نصب و فعال‌سازی خودکار در مرورگر${c.reset}`);
console.log(`${c.dim}     Zero-Click 100% Automated Setup for Chrome, Brave & Edge${c.reset}`);
console.log(`${c.cyan}  ====================================================================${c.reset}`);
console.log('');

// 1. Locate or Download Extension Files
let extPath = path.resolve(__dirname, '..');
const localManifest = path.join(extPath, 'manifest.json');

async function ensureExtensionReady() {
  if (fs.existsSync(localManifest)) {
    return extPath;
  }

  const appDataDir = process.platform === 'win32'
    ? path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'Rastin-RTL')
    : path.join(os.homedir(), '.rastin-rtl');

  const remoteManifest = path.join(appDataDir, 'manifest.json');
  if (fs.existsSync(remoteManifest)) {
    return appDataDir;
  }

  console.log(`  ${c.yellow}[1/5] 📥 در حال دریافت سورس افزونه از گیت‌هاب...${c.reset}`);
  if (!fs.existsSync(appDataDir)) {
    fs.mkdirSync(appDataDir, { recursive: true });
  }

  let gitSuccess = false;
  try {
    execSync(`git clone https://github.com/Mancity1383/Rastin-RTL.git "${appDataDir}"`, { stdio: 'ignore' });
    gitSuccess = true;
  } catch (_) {}

  if (!gitSuccess) {
    const zipPath = path.join(os.tmpdir(), 'rastin-rtl.zip');
    await new Promise((resolve, reject) => {
      const file = fs.createWriteStream(zipPath);
      https.get('https://codeload.github.com/Mancity1383/Rastin-RTL/zip/refs/heads/main', (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          https.get(res.headers.location, (redRes) => {
            redRes.pipe(file);
            file.on('finish', () => file.close(resolve));
          }).on('error', reject);
        } else {
          res.pipe(file);
          file.on('finish', () => file.close(resolve));
        }
      }).on('error', reject);
    });

    if (process.platform === 'win32') {
      execSync(`powershell -NoProfile -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${os.tmpdir()}\\rastin-extract' -Force"`, { stdio: 'ignore' });
      execSync(`powershell -NoProfile -Command "Copy-Item -Path '${os.tmpdir()}\\rastin-extract\\Rastin-RTL-main\\*' -Destination '${appDataDir}' -Recurse -Force"`, { stdio: 'ignore' });
    } else {
      execSync(`unzip -q -o "${zipPath}" -d "${os.tmpdir()}/rastin-extract"`, { stdio: 'ignore' });
      execSync(`cp -rf "${os.tmpdir()}/rastin-extract/Rastin-RTL-main/"* "${appDataDir}/"`, { stdio: 'ignore' });
    }
  }

  return appDataDir;
}

// 2. Detect Installed Chromium Browsers
function findBrowser() {
  const isWin = process.platform === 'win32';
  const isMac = process.platform === 'darwin';

  if (isWin) {
    const progFiles = process.env.ProgramFiles || 'C:\\Program Files';
    const progFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
    const localApp = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');

    const candidates = [
      { name: 'Google Chrome', path: path.join(progFiles, 'Google/Chrome/Application/chrome.exe'), proc: 'chrome' },
      { name: 'Google Chrome (x86)', path: path.join(progFilesX86, 'Google/Chrome/Application/chrome.exe'), proc: 'chrome' },
      { name: 'Google Chrome (User)', path: path.join(localApp, 'Google/Chrome/Application/chrome.exe'), proc: 'chrome' },
      { name: 'Brave Browser', path: path.join(progFiles, 'BraveSoftware/Brave-Browser/Application/brave.exe'), proc: 'brave' },
      { name: 'Brave Browser (User)', path: path.join(localApp, 'BraveSoftware/Brave-Browser/Application/brave.exe'), proc: 'brave' },
      { name: 'Microsoft Edge', path: path.join(progFilesX86, 'Microsoft/Edge/Application/msedge.exe'), proc: 'msedge' },
      { name: 'Microsoft Edge', path: path.join(progFiles, 'Microsoft/Edge/Application/msedge.exe'), proc: 'msedge' },
      { name: 'Vivaldi', path: path.join(localApp, 'Vivaldi/Application/vivaldi.exe'), proc: 'vivaldi' }
    ];

    for (const b of candidates) {
      if (fs.existsSync(b.path)) return b;
    }
  } else if (isMac) {
    const candidates = [
      { name: 'Google Chrome', path: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', proc: 'Google Chrome' },
      { name: 'Brave Browser', path: '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser', proc: 'Brave Browser' },
      { name: 'Microsoft Edge', path: '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', proc: 'Microsoft Edge' }
    ];
    for (const b of candidates) {
      if (fs.existsSync(b.path)) return b;
    }
  } else {
    const bins = ['google-chrome', 'google-chrome-stable', 'brave-browser', 'microsoft-edge', 'chromium'];
    for (const bin of bins) {
      try {
        execSync(`which ${bin}`, { stdio: 'ignore' });
        return { name: bin, path: bin, proc: bin };
      } catch (_) {}
    }
  }
  return null;
}

// 3. Register in Windows Registry
function registerInRegistry(targetDir) {
  if (process.platform !== 'win32') return;
  const extId = 'ideaoieajoamlhieondehojgkobnigdk';
  const regPaths = [
    `HKCU\\Software\\Google\\Chrome\\Extensions\\${extId}`,
    `HKCU\\Software\\Microsoft\\Edge\\Extensions\\${extId}`,
    `HKCU\\Software\\BraveSoftware\\Brave-Browser\\Extensions\\${extId}`
  ];

  for (const r of regPaths) {
    try {
      execSync(`reg add "${r}" /v path /t REG_SZ /d "${targetDir}" /f`, { stdio: 'ignore' });
    } catch (_) {}
  }
  console.log(`  ${c.green}[2/5] 🛡️ ثبت در رجیستری ویندوز برای پایداری افزونه${c.reset}`);
}

// 4. Create and Update Shortcuts (Permanent Activation)
function updateSystemShortcuts(browser, targetDir) {
  if (process.platform !== 'win32') return;
  try {
    const desktop = path.join(os.homedir(), 'Desktop');
    const startMenu = path.join(process.env.APPDATA || '', 'Microsoft', 'Windows', 'Start Menu', 'Programs');
    const dedicatedShortcut = path.join(desktop, 'مرورگر با راستین RTL.lnk');

    const psScript = `
      $ws = New-Object -ComObject WScript.Shell
      
      # 1. Dedicated Shortcut
      $s = $ws.CreateShortcut('${dedicatedShortcut.replace(/'/g, "''")}')
      $s.TargetPath = '${browser.path.replace(/'/g, "''")}'
      $s.Arguments = '--load-extension="${targetDir.replace(/"/g, '`"')}"'
      $s.Description = 'مرورگر همراه با افزونه فعال راستین RTL'
      $s.Save()

      # 2. Patch user desktop shortcut if present
      $userChrome = '${path.join(desktop, 'Google Chrome.lnk').replace(/'/g, "''")}'
      if (Test-Path $userChrome) {
        $c = $ws.CreateShortcut($userChrome)
        $c.Arguments = '--load-extension="${targetDir.replace(/"/g, '`"')}"'
        $c.Save()
      }

      # 3. Patch start menu shortcut if present
      $startChrome = '${path.join(startMenu, 'Google Chrome.lnk').replace(/'/g, "''")}'
      if (Test-Path $startChrome) {
        $sc = $ws.CreateShortcut($startChrome)
        $sc.Arguments = '--load-extension="${targetDir.replace(/"/g, '`"')}"'
        $sc.Save()
      }
    `;

    execSync(`powershell -NoProfile -Command "${psScript.replace(/\n/g, ' ')}"`, { stdio: 'ignore' });
    console.log(`  ${c.green}[3/5] 🔗 شورتکات‌های سیستم با افزونه فعال خودکار بروزرسانی شدند${c.reset}`);
  } catch (_) {}
}

// 5. Copy Path to Clipboard as secondary backup
function copyToClipboard(text) {
  try {
    if (process.platform === 'win32') {
      const ps = spawn('powershell', ['-NoProfile', '-Command', 'Set-Clipboard -Value $Input'], { stdio: ['pipe', 'ignore', 'ignore'] });
      ps.stdin.write(text);
      ps.stdin.end();
      return true;
    }
  } catch (_) {}
  return false;
}

// 6. Launch Browser with Extension Activated
function launchActiveBrowser(browser, targetDir) {
  const isWin = process.platform === 'win32';

  if (isWin && browser.proc) {
    try {
      const stdout = execSync(`tasklist /FI "IMAGENAME eq ${browser.proc}.exe" /NH`, { encoding: 'utf8' });
      if (stdout.toLowerCase().includes(`${browser.proc.toLowerCase()}.exe`)) {
        console.log(`  ${c.yellow}[4/5] 🔄 بستن نمونه قبلی ${browser.name} برای لود تمیز افزونه...${c.reset}`);
        execSync(`taskkill /F /IM ${browser.proc}.exe /T`, { stdio: 'ignore' });
        // Tiny wait for process handles to close
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 800);
      } else {
        console.log(`  ${c.green}[4/5] 🔍 آماده‌سازی راه‌اندازی مرورگر...${c.reset}`);
      }
    } catch (_) {}
  }

  console.log(`  ${c.yellow}[5/5] 🚀 راه‌اندازی مرورگر و فعال‌سازی فوری راستین RTL...${c.reset}`);
  
  const launchArgs = [
    `--load-extension=${targetDir}`,
    'https://fa.wikipedia.org/wiki/%D8%B5%D9%81%D8%AD%D9%87%D9%94_%D8%A7%D8%B5%D9%84%DB%8C'
  ];

  const child = spawn(browser.path, launchArgs, {
    detached: true,
    stdio: 'ignore'
  });
  child.unref();
}

async function main() {
  try {
    const resolvedPath = await ensureExtensionReady();
    console.log(`  ${c.green}[✔] پوشه افزونه مستقر شد: ${c.cyan}${resolvedPath}${c.reset}`);

    // Register in Registry
    registerInRegistry(resolvedPath);

    // Find browser
    const browser = findBrowser();
    if (browser) {
      console.log(`  ${c.green}[✔] مرورگر شناسایی شد: ${c.bold}${browser.name}${c.reset}`);

      // Update shortcuts so every future click runs with extension
      updateSystemShortcuts(browser, resolvedPath);

      // Clipboard helper
      copyToClipboard(resolvedPath);

      // Launch browser immediately with extension loaded
      launchActiveBrowser(browser, resolvedPath);

      console.log('');
      console.log(`${c.brightGreen}  ====================================================================${c.reset}`);
      console.log(`${c.bold}${c.brightGreen}     🎉 افزونه راستین RTL با موفقیت روی مرورگر نصب و فعال شد!${c.reset}`);
      console.log(`${c.brightGreen}  ====================================================================${c.reset}`);
      console.log('');
      console.log(`  ${c.white}✅ مرورگر شما با افزونه فعال اجرا شد و صفحه نمونه باز گردید.${c.reset}`);
      console.log(`  ${c.white}✅ شورتکات‌های سیستم بروزرسانی شدند تا هر بار روی مرورگر کلیک کنید افزونه فعال باشد.${c.reset}`);
      console.log('');
      console.log(`  ${c.brightCyan}✨ از وبگردی با چیدمان و فونت زیبای فارسی لذت ببرید!${c.reset}`);
      console.log('');
    } else {
      console.log(`  ${c.yellow}[!] مرورگر کرومیومی خودکار پیدا نشد.${c.reset}`);
      console.log(`      مسیر افزونه: ${c.cyan}${resolvedPath}${c.reset}`);
    }
  } catch (err) {
    console.error(`${c.red}خطا در اجرای فرآیند خودکار:${c.reset}`, err.message);
    process.exit(1);
  }
}

main();
