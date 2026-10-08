import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';

const PRODUCT = 'Rastin-RTL';
const MARKER = '.rastin-install.json';
const RUNTIME = ['manifest.json', 'background.js', 'ruleset_adblock.json', 'cosmetic_rules.json', 'content', 'popup', 'fonts', 'icons', 'LICENSE'];
const BROWSERS = ['auto', 'chrome', 'edge', 'brave', 'vivaldi'];
const bundledSource = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function defaultInstallDirectory({ platform = process.platform, env = process.env, home = os.homedir() } = {}) {
  if (platform === 'win32') return path.join(env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), PRODUCT);
  if (platform === 'darwin') return path.join(home, 'Library', 'Application Support', PRODUCT);
  return path.join(env.XDG_DATA_HOME || path.join(home, '.local', 'share'), 'rastin-rtl');
}

export function parseArgs(args) {
  const result = { source: bundledSource, target: defaultInstallDirectory(), browser: 'auto', noOpen: false, help: false };
  for (let i = 0; i < args.length; i += 1) {
    const option = args[i];
    if (option === '--help' || option === '-h') result.help = true;
    else if (option === '--no-open') result.noOpen = true;
    else if (['--dir', '--source', '--browser'].includes(option)) {
      const value = args[++i];
      if (!value || value.startsWith('--')) throw new Error('Missing value for ' + option + '.');
      result[option === '--dir' ? 'target' : option.slice(2)] = value;
    } else throw new Error('Unknown option: ' + option + '. Use --help.');
  }
  if (!BROWSERS.includes(result.browser)) throw new Error('Unsupported browser: ' + result.browser + '.');
  result.source = path.resolve(result.source);
  result.target = path.resolve(result.target);
  return result;
}

function exists(file) {
  try { fs.lstatSync(file); return true; } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

function isWithin(parent, child) {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative));
}

function assertNoLinkedAncestors(file) {
  let current = path.resolve(file);
  while (true) {
    if (exists(current) && fs.lstatSync(current).isSymbolicLink()) throw new Error('Symbolic links and junctions are not allowed: ' + current);
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
}

function assertPlainTree(file) {
  const stat = fs.lstatSync(file);
  if (stat.isSymbolicLink()) throw new Error('Symbolic links and junctions are not allowed: ' + file);
  if (stat.isDirectory()) {
    for (const entry of fs.readdirSync(file)) assertPlainTree(path.join(file, entry));
  } else if (!stat.isFile()) throw new Error('Unsupported filesystem entry: ' + file);
}

function runtimeFiles(root) {
  const result = [];
  const visit = (file) => {
    const stat = fs.lstatSync(file);
    if (stat.isSymbolicLink()) throw new Error('Symbolic links and junctions are not allowed: ' + file);
    if (stat.isDirectory()) {
      for (const entry of fs.readdirSync(file)) visit(path.join(file, entry));
    } else if (stat.isFile()) result.push(file);
    else throw new Error('Unsupported filesystem entry: ' + file);
  };
  for (const relative of RUNTIME) {
    const file = path.join(root, relative);
    if (!exists(file)) throw new Error('Missing runtime asset: ' + relative);
    const stat = fs.lstatSync(file);
    const directory = ['content', 'popup', 'fonts', 'icons'].includes(relative);
    if (stat.isSymbolicLink() || (directory ? !stat.isDirectory() : !stat.isFile())) throw new Error('Invalid runtime asset: ' + relative);
    visit(file);
  }
  return result;
}

function checkedReference(root, file, reference, { fromRoot = false, wildcard = false, files = [] } = {}) {
  if (typeof reference !== 'string' || !reference.trim()) throw new Error('Invalid runtime path in ' + path.relative(root, file) + '.');
  const clean = reference.split(/[?#]/, 1)[0].replaceAll('\\', '/');
  if (/%(?:2f|5c|2e)/i.test(clean) || clean.includes('\0') || /^[a-z][a-z\d+.-]*:/i.test(clean) || clean.startsWith('/')) {
    throw new Error('Unsafe runtime path: ' + reference);
  }
  const base = fromRoot ? root : path.dirname(file);
  const absolute = path.resolve(base, clean);
  if (!isWithin(root, absolute)) throw new Error('Runtime path escapes extension directory: ' + reference);
  const relative = path.relative(root, absolute).split(path.sep).join('/');
  if (!RUNTIME.some((item) => relative === item || relative.startsWith(item + '/'))) throw new Error('Runtime path is not included in the installation: ' + reference);
  if (wildcard && clean.includes('*')) {
    const escape = (value) => value.replace(/[.+?^\x24{}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp('^' + escape(relative).replaceAll('*', '.*') + '$');
    if (!files.some((item) => pattern.test(path.relative(root, item).split(path.sep).join('/')))) throw new Error('Missing runtime assets for pattern: ' + reference);
    return;
  }
  if (!exists(absolute) || !fs.lstatSync(absolute).isFile()) throw new Error('Missing referenced runtime asset: ' + reference);
  assertNoLinkedAncestors(absolute);
}

function isLocal(reference) {
  return reference && !/^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(reference);
}

/** Validate both declared resources and file references before replacing any installation. */
export function validateRuntime(source) {
  const root = path.resolve(source);
  assertNoLinkedAncestors(root);
  const files = runtimeFiles(root);
  const manifestFile = path.join(root, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8').replace(/^\uFEFF/, ''));
  const versionParts = typeof manifest.version === 'string' ? manifest.version.split('.') : [];
  const validVersion = versionParts.length >= 1 && versionParts.length <= 4 &&
    versionParts.every((part) => /^(?:0|[1-9]\d*)$/.test(part) && Number(part) <= 65535) &&
    versionParts.some((part) => Number(part) > 0);
  if (manifest.manifest_version !== 3 || manifest.name !== 'Rastin RTL' || !validVersion) throw new Error('Expected a valid Rastin RTL Manifest V3 extension.');
  if (!manifest.background?.service_worker || !manifest.action?.default_popup || !Array.isArray(manifest.content_scripts) || !manifest.content_scripts.length) throw new Error('The extension manifest is incomplete.');
  const declared = [manifest.background.service_worker, manifest.action.default_popup];
  const icons = (value) => { if (typeof value === 'string') declared.push(value); else if (value) declared.push(...Object.values(value)); };
  icons(manifest.icons);
  icons(manifest.action.default_icon);
  for (const script of manifest.content_scripts) declared.push(...(script.js || []), ...(script.css || []));
  for (const rule of manifest.declarative_net_request?.rule_resources || []) declared.push(rule.path);
  for (const field of ['options_page', 'devtools_page']) if (manifest[field]) declared.push(manifest[field]);
  if (manifest.options_ui?.page) declared.push(manifest.options_ui.page);
  if (manifest.side_panel?.default_path) declared.push(manifest.side_panel.default_path);
  declared.push(...Object.values(manifest.chrome_url_overrides || {}));
  for (const reference of declared) checkedReference(root, manifestFile, reference, { fromRoot: true });
  for (const group of manifest.web_accessible_resources || []) {
    for (const reference of group.resources || []) checkedReference(root, manifestFile, reference, { fromRoot: true, wildcard: true, files });
  }
  for (const file of files) {
    if (/\.json$/i.test(file)) JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
    if (!/\.(?:html|css|js)$/i.test(file)) continue;
    const text = fs.readFileSync(file, 'utf8');
    if (/\.html$/i.test(file)) {
      for (const match of text.matchAll(/\b(?:src|href)\s*=\s*(["'])(.*?)\1/gi)) {
        if (isLocal(match[2])) checkedReference(root, file, match[2]);
      }
    }
    if (/\.css$/i.test(file)) {
      for (const match of text.matchAll(/url\(\s*(?:(["'])(.*?)\1|([^\s)]+))\s*\)/gi)) {
        const reference = match[2] ?? match[3];
        if (isLocal(reference)) checkedReference(root, file, reference);
      }
      for (const match of text.matchAll(/@import\s+(["'])(.*?)\1/gi)) {
        if (isLocal(match[2])) checkedReference(root, file, match[2]);
      }
    }
    if (/\.js$/i.test(file)) {
      for (const match of text.matchAll(/\b(?:chrome|browser)\.runtime\.getURL\(\s*(["'])([^'"\r\n]+)\1\s*\)/g)) checkedReference(root, file, match[2], { fromRoot: true });
      for (const call of text.matchAll(/\bimportScripts\(([^)]*)\)/g)) {
        for (const match of call[1].matchAll(/(["'])(.*?)\1/g)) checkedReference(root, file, match[2]);
      }
    }
  }
  return { manifest, files };
}

function copyRuntime(source, stage) {
  // Avoid fs.cpSync realpath handling, which corrupts non-ASCII Windows paths
  // in some Node releases. Copy only regular files and directories explicitly.
  const copy = (from, to) => {
    const stat = fs.lstatSync(from);
    if (stat.isSymbolicLink()) throw new Error('Symbolic links and junctions are not allowed: ' + from);
    if (stat.isDirectory()) {
      fs.mkdirSync(to);
      for (const entry of fs.readdirSync(from)) copy(path.join(from, entry), path.join(to, entry));
    } else if (stat.isFile()) fs.copyFileSync(from, to, fs.constants.COPYFILE_EXCL);
    else throw new Error('Unsupported filesystem entry: ' + from);
  };
  for (const relative of RUNTIME) copy(path.join(source, relative), path.join(stage, relative));
}

/** Keep the same browser-facing directory on updates, and roll back a failed swap. */
export function installExtension({ source = bundledSource, target = defaultInstallDirectory(), defaultTarget = defaultInstallDirectory() } = {}) {
  source = path.resolve(source);
  target = path.resolve(target);
  defaultTarget = path.resolve(defaultTarget);
  if (target === path.parse(target).root || target === path.resolve(os.homedir())) throw new Error('The installation directory must be a dedicated extension folder.');
  if (isWithin(source, target) || isWithin(target, source)) throw new Error('Source and installation directories must not overlap.');
  assertNoLinkedAncestors(source);
  assertNoLinkedAncestors(target);
  validateRuntime(source);
  let legacy = false;
  let previous = false;
  if (exists(target)) {
    if (!fs.lstatSync(target).isDirectory()) throw new Error('The installation path is not a directory.');
    assertPlainTree(target);
    const marker = path.join(target, MARKER);
    if (exists(marker)) {
      let saved;
      try { saved = JSON.parse(fs.readFileSync(marker, 'utf8')); } catch { throw new Error('The installation marker is invalid; existing files were preserved.'); }
      if (saved.product !== PRODUCT || saved.format !== 1) throw new Error('The directory is not managed by this installer; existing files were preserved.');
    } else if (target === defaultTarget) {
      try { validateRuntime(target); } catch { throw new Error('The default directory is not a valid legacy Rastin RTL installation; existing files were preserved.'); }
      legacy = true;
    } else throw new Error('The directory already exists and is not managed by this installer. Choose a new --dir; existing files were preserved.');
    previous = true;
  }
  const parent = path.dirname(target);
  fs.mkdirSync(parent, { recursive: true });
  assertNoLinkedAncestors(parent);
  const suffix = randomUUID();
  const stage = path.join(parent, '.' + path.basename(target) + '.stage-' + suffix);
  const backup = path.join(parent, '.' + path.basename(target) + '.backup-' + suffix);
  fs.mkdirSync(stage);
  let backedUp = false;
  let activated = false;
  try {
    copyRuntime(source, stage);
    validateRuntime(stage);
    fs.writeFileSync(path.join(stage, MARKER), JSON.stringify({ product: PRODUCT, format: 1 }, null, 2) + '\n', { flag: 'wx' });
    if (previous) { fs.renameSync(target, backup); backedUp = true; }
    fs.renameSync(stage, target);
    activated = true;
  } catch (error) {
    if (backedUp && !activated) {
      try { fs.renameSync(backup, target); } catch (rollbackError) {
        throw new Error(error.message + ' Rollback failed: ' + rollbackError.message + '. Previous installation is preserved at ' + backup + '.');
      }
    }
    throw error;
  } finally {
    if (exists(stage)) fs.rmSync(stage, { recursive: true, force: true });
  }
  let retainedBackup = legacy && backedUp ? backup : null;
  if (backedUp && !legacy) {
    try { fs.rmSync(backup, { recursive: true, force: true }); } catch { retainedBackup = backup; }
  }
  return { target, updated: previous, backup: retainedBackup };
}

function findOnPath(names) {
  for (const name of names) {
    for (const directory of (process.env.PATH || '').split(path.delimiter)) {
      const file = path.join(directory, name);
      try { fs.accessSync(file, fs.constants.X_OK); if (fs.statSync(file).isFile()) return file; } catch { /* Try the next candidate. */ }
    }
  }
  return null;
}

function findBrowser(preference) {
  const appData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  const programFiles = [process.env.ProgramFiles || 'C:\\Program Files', process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', appData];
  const configurations = {
    chrome: { label: 'Google Chrome', url: 'chrome://extensions', win: 'Google/Chrome/Application/chrome.exe', mac: 'Google Chrome', linux: ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser'] },
    edge: { label: 'Microsoft Edge', url: 'edge://extensions', win: 'Microsoft/Edge/Application/msedge.exe', mac: 'Microsoft Edge', linux: ['microsoft-edge', 'microsoft-edge-stable'] },
    brave: { label: 'Brave', url: 'brave://extensions', win: 'BraveSoftware/Brave-Browser/Application/brave.exe', mac: 'Brave Browser', linux: ['brave-browser', 'brave-browser-stable'] },
    vivaldi: { label: 'Vivaldi', url: 'vivaldi://extensions', win: 'Vivaldi/Application/vivaldi.exe', mac: 'Vivaldi', linux: ['vivaldi', 'vivaldi-stable'] }
  };
  for (const name of preference === 'auto' ? ['chrome', 'edge', 'brave', 'vivaldi'] : [preference]) {
    const config = configurations[name];
    let executable;
    if (process.platform === 'win32') executable = programFiles.map((root) => path.join(root, config.win)).find(exists);
    else if (process.platform === 'darwin') executable = [path.join('/Applications', config.mac + '.app', 'Contents', 'MacOS', config.mac), path.join(os.homedir(), 'Applications', config.mac + '.app', 'Contents', 'MacOS', config.mac)].find(exists);
    else executable = findOnPath(config.linux);
    if (executable) return { ...config, executable };
  }
  return null;
}

function runHelper(command, args, input) {
  return new Promise((resolve) => {
    let settled = false;
    let timer;
    const finish = (success) => { if (!settled) { settled = true; clearTimeout(timer); resolve(success); } };
    try {
      const child = spawn(command, args, { windowsHide: true, stdio: [input === undefined ? 'ignore' : 'pipe', 'ignore', 'ignore'] });
      timer = setTimeout(() => { child.kill(); finish(false); }, 5000);
      child.once('error', () => finish(false));
      child.once('close', (code) => finish(code === 0));
      if (child.stdin) { child.stdin.on('error', () => finish(false)); child.stdin.end(input); }
    } catch { finish(false); }
  });
}

async function copyPath(target) {
  if (process.platform === 'win32') return runHelper('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false); $value = [Console]::In.ReadToEnd(); Set-Clipboard -Value $value -ErrorAction Stop'], target);
  if (process.platform === 'darwin') return runHelper('pbcopy', [], target);
  if (process.env.WAYLAND_DISPLAY && findOnPath(['wl-copy'])) return runHelper('wl-copy', [], target);
  if (findOnPath(['xclip'])) return runHelper('xclip', ['-selection', 'clipboard'], target);
  if (findOnPath(['xsel'])) return runHelper('xsel', ['--clipboard', '--input'], target);
  return false;
}

function launch(command, args) {
  return new Promise((resolve) => {
    try {
      const child = spawn(command, args, { windowsHide: true, detached: true, stdio: 'ignore' });
      child.once('error', () => resolve(false));
      child.once('spawn', () => { child.unref(); resolve(true); });
    } catch { resolve(false); }
  });
}

async function openFolder(target) {
  if (process.platform === 'win32') return launch('explorer.exe', [target]);
  if (process.platform === 'darwin') return launch('open', [target]);
  const executable = findOnPath(['xdg-open']);
  return executable ? launch(executable, [target]) : false;
}

export async function main(args = process.argv.slice(2)) {
  const options = parseArgs(args);
  if (options.help) {
    console.log('Rastin RTL installer\n\nUsage: rastin-rtl [options]\n\n  --dir PATH       Dedicated stable installation directory\n  --source PATH    Extension source (defaults to this package)\n  --browser NAME   auto, chrome, edge, brave, vivaldi (default: auto)\n  --no-open        Skip browser, clipboard and folder helpers\n  --help, -h       Show this help without installing\n\nDefault directory: ' + defaultInstallDirectory() + '\n\nCopies bundled runtime files; no separate download or Git is required.\nAfter installation, enable Developer mode and choose Load unpacked\nin your browser extensions page. Select the directory printed below.\nUpdates replace files at the same path; click Reload in the browser.');
    return;
  }
  const result = installExtension(options);
  console.log('Rastin RTL ' + (result.updated ? 'updated' : 'installed') + ' at:\n' + result.target);
  if (result.backup) console.log('Previous files retained at: ' + result.backup);
  if (!options.noOpen) {
    const copied = await copyPath(result.target);
    console.log(copied ? 'Installation path copied to clipboard.' : 'Clipboard unavailable; copy the installation path above.');
    const browser = findBrowser(options.browser);
    if (browser) console.log(await launch(browser.executable, [browser.url]) ? 'Requested ' + browser.label + ' extensions page.' : 'Could not open ' + browser.label + '; open ' + browser.url + ' manually.');
    else console.log('Browser not found; open your browser extensions page manually.');
    if (!await openFolder(result.target)) console.log('Could not open the installation folder; use the path above.');
  }
  console.log('\nFirst install: open chrome://extensions (Edge: edge://extensions), enable Developer mode,\nchoose Load unpacked, and select the installation directory.\nAfter an update: click Reload on the existing extension, then refresh open pages.\nKeep this directory in place; unpacked extensions are installed in this browser profile.');
  return result;
}