#!/usr/bin/env node

/**
 * ==============================================================================
 * ✨ Rastin RTL - One-Command Automated Launcher & Installer
 * CLI tool for npx rastin-rtl / npx antigravity-rtl
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
console.log(`${c.bold}${c.brightGreen}     ✨ راستین RTL (Rastin RTL) - راه‌اندازی و نصب خودکار در مرورگر${c.reset}`);
console.log(`${c.dim}     Zero-Config Automated Extension Setup for Chrome, Brave & Edge${c.reset}`);
console.log(`${c.cyan}  ====================================================================${c.reset}`);
console.log('');

// 1. Locate or Download Extension Files
let extPath = path.resolve(__dirname, '..');
const localManifest = path.join(extPath, 'manifest.json');

async function ensureExtensionReady() {
  if (fs.existsSync(localManifest)) {
    return extPath;
  }

  // If executed via npx without local clone, install into LocalAppData or ~/.rastin-rtl
  const appDataDir = process.platform === 'win32'
    ? path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'Rastin-RTL')
    : path.join(os.homedir(), '.rastin-rtl');

  const remoteManifest = path.join(appDataDir, 'manifest.json');
  if (fs.existsSync(remoteManifest)) {
    return appDataDir;
  }

  console.log(`  ${c.yellow}[1/4] 📥 در حال دانلود آخرین نسخه افزونه از گیت‌هاب...${c.reset}`);
  if (!fs.existsSync(appDataDir)) {
    fs.mkdirSync(appDataDir, { recursive: true });
  }

  // Clone with git if available, or download zip
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

    // Extract zip
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

// 2. Find Chromium Browser
function findBrowser() {
  const isWin = process.platform === 'win32';
  const isMac = process.platform === 'darwin';

  if (isWin) {
    const progFiles = process.env.ProgramFiles || 'C:\\Program Files';
    const progFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
    const localApp = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');

    const candidates = [
      { name: 'Google Chrome', path: path.join(progFiles, 'Google/Chrome/Application/chrome.exe'), url: 'chrome://extensions' },
      { name: 'Google Chrome (x86)', path: path.join(progFilesX86, 'Google/Chrome/Application/chrome.exe'), url: 'chrome://extensions' },
      { name: 'Google Chrome (User)', path: path.join(localApp, 'Google/Chrome/Application/chrome.exe'), url: 'chrome://extensions' },
      { name: 'Brave Browser', path: path.join(progFiles, 'BraveSoftware/Brave-Browser/Application/brave.exe'), url: 'brave://extensions' },
      { name: 'Brave Browser (User)', path: path.join(localApp, 'BraveSoftware/Brave-Browser/Application/brave.exe'), url: 'brave://extensions' },
      { name: 'Microsoft Edge', path: path.join(progFilesX86, 'Microsoft/Edge/Application/msedge.exe'), url: 'edge://extensions' },
      { name: 'Microsoft Edge', path: path.join(progFiles, 'Microsoft/Edge/Application/msedge.exe'), url: 'edge://extensions' },
      { name: 'Vivaldi', path: path.join(localApp, 'Vivaldi/Application/vivaldi.exe'), url: 'vivaldi://extensions' }
    ];

    for (const b of candidates) {
      if (fs.existsSync(b.path)) return b;
    }
  } else if (isMac) {
    const candidates = [
      { name: 'Google Chrome', path: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', url: 'chrome://extensions' },
      { name: 'Brave Browser', path: '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser', url: 'brave://extensions' },
      { name: 'Microsoft Edge', path: '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', url: 'edge://extensions' }
    ];
    for (const b of candidates) {
      if (fs.existsSync(b.path)) return b;
    }
  } else {
    const bins = ['google-chrome', 'google-chrome-stable', 'brave-browser', 'microsoft-edge', 'chromium'];
    for (const bin of bins) {
      try {
        execSync(`which ${bin}`, { stdio: 'ignore' });
        return { name: bin, path: bin, url: 'chrome://extensions' };
      } catch (_) {}
      }
  }
  return null;
}

// 3. Copy to Clipboard
function copyToClipboard(text) {
  try {
    if (process.platform === 'win32') {
      const ps = spawn('powershell', ['-NoProfile', '-Command', 'Set-Clipboard -Value $Input'], { stdio: ['pipe', 'ignore', 'ignore'] });
      ps.stdin.write(text);
      ps.stdin.end();
      return true;
    } else if (process.platform === 'darwin') {
      const pb = spawn('pbcopy');
      pb.stdin.write(text);
      pb.stdin.end();
      return true;
    } else {
      const xc = spawn('xclip', ['-selection', 'clipboard']);
      xc.stdin.write(text);
      xc.stdin.end();
      return true;
    }
  } catch (_) {
    return false;
  }
}

// 4. Create Desktop Shortcut on Windows
function createDesktopShortcut(browser, targetDir) {
  if (process.platform !== 'win32') return;
  try {
    const desktop = path.join(os.homedir(), 'Desktop');
    if (!fs.existsSync(desktop)) return;

    const shortcutPath = path.join(desktop, 'مرورگر با راستین RTL.lnk');
    const psScript = `
      $ws = New-Object -ComObject WScript.Shell
      $s = $ws.CreateShortcut('${shortcutPath.replace(/'/g, "''")}')
      $s.TargetPath = '${browser.path.replace(/'/g, "''")}'
      $s.Arguments = '--load-extension="${targetDir.replace(/"/g, '`"')}"'
      $s.Description = 'اجرای مرورگر همراه با افزونه راستین RTL'
      $s.Save()
    `;
    execSync(`powershell -NoProfile -Command "${psScript.replace(/\n/g, ' ')}"`, { stdio: 'ignore' });
    console.log(`  ${c.green}[✔] شورتکات دسکتاپ ایجاد شد: 'مرورگر با راستین RTL'${c.reset}`);
  } catch (_) {}
}

async function main() {
  try {
    const resolvedPath = await ensureExtensionReady();
    console.log(`  ${c.green}[1/4] 📁 مسیر افزونه شناسایی شد:${c.reset}`);
    console.log(`        ${c.cyan}${resolvedPath}${c.reset}`);

    // Clipboard
    const copied = copyToClipboard(resolvedPath);
    if (copied) {
      console.log(`  ${c.green}[2/4] 📋 مسیر پوشه افزونه به‌طور خودکار در کلیپ‌بورد کپی شد.${c.reset}`);
    }

    // Find Browser
    console.log(`  ${c.yellow}[3/4] 🔍 در حال بررسی مرورگرهای سیستم...${c.reset}`);
    const browser = findBrowser();

    if (browser) {
      console.log(`  ${c.green}[✔] مرورگر شناسایی شد: ${c.bold}${browser.Name || browser.name}${c.reset}`);

      // Create desktop shortcut
      createDesktopShortcut(browser, resolvedPath);

      // Launch Browser with extension loaded
      console.log(`  ${c.yellow}[4/4] 🚀 در حال راه‌اندازی مرورگر و فعال‌سازی لحظه‌ای افزونه...${c.reset}`);
      const launchArgs = [
        `--load-extension=${resolvedPath}`,
        browser.url
      ];

      const child = spawn(browser.path, launchArgs, {
        detached: true,
        stdio: 'ignore'
      });
      child.unref();

      console.log('');
      console.log(`${c.brightGreen}  ====================================================================${c.reset}`);
      console.log(`${c.bold}${c.brightGreen}     🎉 مرورگر با افزونه راستین RTL با موفقیت اجرا شد!${c.reset}`);
      console.log(`${c.brightGreen}  ====================================================================${c.reset}`);
      console.log('');
      console.log(`  ${c.bold}💡 برای نصب دائمی در مرورگر (تنها برای بار اول):${c.reset}`);
      console.log(`     ۱. در برگه ${c.cyan}${browser.url}${c.reset} که باز شده، دکمه ${c.yellow}Developer mode${c.reset} (بالا راست) را روشن کنید.`);
      console.log(`     ۲. روی دکمه ${c.yellow}Load unpacked${c.reset} (یا بارگیری بازنشده) کلیک کنید.`);
      console.log(`     ۳. در پنجره انتخاب پوشه، کلید ${c.bold}${c.brightCyan}[Ctrl + V]${c.reset} را بزنید و ${c.bold}${c.brightCyan}[Enter]${c.reset} کنید.`);
      console.log(`        ${c.dim}(مسیر پوشه افزونه آماده است و در کلیپ‌بورد کپی شده!)${c.reset}`);
      console.log('');
      console.log(`  ${c.green}✨ افزونه شما آماده استفاده است. از وبگردی زیبا لذت ببرید!${c.reset}`);
      console.log('');
    } else {
      console.log(`  ${c.yellow}[!] مرورگر کرومیومی خودکار پیدا نشد.${c.reset}`);
      console.log(`      مسیر افزونه: ${c.cyan}${resolvedPath}${c.reset}`);
      console.log(`      در مرورگر خود به آدرس chrome://extensions بروید، Load unpacked را بزنید و این مسیر را پیست کنید.`);
      console.log('');
    }
  } catch (err) {
    console.error(`${c.red}خطا در اجرای برنامه:${c.reset}`, err.message);
    process.exit(1);
  }
}

main();
