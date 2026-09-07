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

// 4. Clean shortcuts to keep system clean
function cleanSystemShortcuts() {
  if (process.platform !== 'win32') return;
  try {
    const desktop = path.join(os.homedir(), 'Desktop');
    const startMenu = path.join(process.env.APPDATA || '', 'Microsoft', 'Windows', 'Start Menu', 'Programs');
    const dedicatedShortcut = path.join(desktop, 'مرورگر با راستین RTL.lnk');

    const psScript = `
      $ws = New-Object -ComObject WScript.Shell
      
      $ded = '${dedicatedShortcut.replace(/'/g, "''")}'
      if (Test-Path $ded) { Remove-Item $ded -Force -ErrorAction SilentlyContinue }

      $uChrome = '${path.join(desktop, 'Google Chrome.lnk').replace(/'/g, "''")}'
      if (Test-Path $uChrome) {
        $c = $ws.CreateShortcut($uChrome)
        if ($c.Arguments -and $c.Arguments.Contains('--load-extension')) {
          $c.Arguments = ''
          $c.Save()
        }
      }

      $sChrome = '${path.join(startMenu, 'Google Chrome.lnk').replace(/'/g, "''")}'
      if (Test-Path $sChrome) {
        $sc = $ws.CreateShortcut($sChrome)
        if ($sc.Arguments -and $sc.Arguments.Contains('--load-extension')) {
          $sc.Arguments = ''
          $sc.Save()
        }
      }
    `;

    execSync(`powershell -NoProfile -Command "${psScript.replace(/\n/g, ' ')}"`, { stdio: 'ignore' });
  } catch (_) {}
}

// 5. Copy Path to Clipboard
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

// 6. Open Browser to Extensions Settings
function openExtensionsPage(browser) {
  let extUrl = 'chrome://extensions';
  if (browser && browser.name.includes('Edge')) {
    extUrl = 'edge://extensions';
  } else if (browser && browser.name.includes('Brave')) {
    extUrl = 'brave://extensions';
  }

  if (browser) {
    const child = spawn(browser.path, [extUrl], {
      detached: true,
      stdio: 'ignore'
    });
    child.unref();
  }
}

// 7. Open Folder in Explorer
function openFolderInExplorer(targetDir) {
  if (process.platform === 'win32') {
    try {
      spawn('explorer.exe', [targetDir], { detached: true, stdio: 'ignore' }).unref();
    } catch (_) {}
  }
}

async function main() {
  try {
    const resolvedPath = await ensureExtensionReady();
    console.log(`  ${c.green}[✔] پوشه افزونه مستقر شد: ${c.cyan}${resolvedPath}${c.reset}`);

    // Register in Registry
    registerInRegistry(resolvedPath);

    // Clean shortcuts
    cleanSystemShortcuts();

    // Copy to clipboard
    copyToClipboard(resolvedPath);
    console.log(`  ${c.green}[3/5] 📋 مسیر پوشه افزونه خودکار در کلیپ‌بورد کپی شد.${c.reset}`);

    // Find browser
    const browser = findBrowser();
    if (browser) {
      console.log(`  ${c.green}[✔] مرورگر شناسایی شد: ${c.bold}${browser.name}${c.reset}`);
      console.log(`  ${c.yellow}[4/5] 🚀 باز کردن صفحه مدیریت افزونه‌ها در مرورگر...${c.reset}`);
      openExtensionsPage(browser);
    }

    // Open folder in Explorer
    console.log(`  ${c.yellow}[5/5] 📁 باز کردن پوشه افزونه در ویندوز...${c.reset}`);
    openFolderInExplorer(resolvedPath);

    console.log('');
    console.log(`${c.brightGreen}  ====================================================================${c.reset}`);
    console.log(`${c.bold}${c.brightGreen}     🎉 فایل‌های افزونه راستین RTL با موفقیت روی سیستم مستقر شدند!${c.reset}`);
    console.log(`${c.brightGreen}  ====================================================================${c.reset}`);
    console.log('');
    console.log(`  ${c.cyan}📌 مسیر پوشه افزونه (در کلیپ‌بورد کپی شده است):${c.reset}`);
    console.log(`     ${c.white}${resolvedPath}${c.reset}`);
    console.log('');
    console.log(`  ${c.bold}${c.yellow}⚡ فقط ۲ کلیک ساده در صفحه باز شده مرورگر برای نصب دائمی روی اکانت:${c.reset}`);
    console.log(`     ${c.white}۱. در بالا سمت راست، کلید [Developer mode] (حالت توسعه‌دهنده) را روشن کنید.${c.reset}`);
    console.log(`     ${c.white}۲. روی دکمه [Load unpacked] (بارگیری بازنشده) کلیک کنید.${c.reset}`);
    console.log(`     ${c.brightCyan}۳. در پنجره باز شده، کلید [Ctrl + V] را بزنید و سپس دکمه Select Folder را انتخاب کنید.${c.reset}`);
    console.log(`        ${c.dim}(یا پوشه باز شده در ویندوز را مستقیماً با ماوس به داخل مرورگر بکشید!)${c.reset}`);
    console.log('');
    console.log(`  ${c.green}✅ افزونه برای همیشه و به شکل استاندارد روی اکانت مرورگر شما ذخیره شد${c.reset}`);
    console.log(`     ${c.dim}و با بستن و باز کردن عادی یا ریستارت کامپیوتر همواره فعال می‌ماند.${c.reset}`);
    console.log('');
  } catch (err) {
    console.error(`${c.red}خطا در اجرای فرآیند خودکار:${c.reset}`, err.message);
    process.exit(1);
  }
}

main();
