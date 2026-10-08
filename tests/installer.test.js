import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { installExtension, validateRuntime, defaultInstallDirectory, parseArgs } from '../bin/install.js';

const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temporaryRoot = path.join(workspace, 'logs', 'installer-tests');
fs.mkdirSync(temporaryRoot, { recursive: true });

function sandbox(t) {
  const directory = fs.mkdtempSync(path.join(temporaryRoot, 'case-'));
  t.after(() => {
    const relative = path.relative(temporaryRoot, path.resolve(directory));
    assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative));
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return directory;
}

function fixture(directory) {
  fs.mkdirSync(directory, { recursive: true });
  for (const folder of ['content', 'popup', 'fonts', 'icons']) fs.mkdirSync(path.join(directory, folder));
  const manifest = {
    manifest_version: 3, name: 'Rastin RTL', version: '1.0.0',
    background: { service_worker: 'background.js' },
    action: { default_popup: 'popup/popup.html', default_icon: { 16: 'icons/icon.png' } },
    icons: { 16: 'icons/icon.png' },
    content_scripts: [{ matches: ['<all_urls>'], js: ['content/main.js'], css: ['content/main.css'] }],
    declarative_net_request: { rule_resources: [{ id: 'rules', path: 'ruleset_adblock.json', enabled: true }] },
    web_accessible_resources: [{ resources: ['fonts/*.woff2', 'cosmetic_rules.json'], matches: ['<all_urls>'] }]
  };
  const files = {
    'manifest.json': JSON.stringify(manifest),
    'background.js': "importScripts('content/main.js');",
    'ruleset_adblock.json': '[]',
    'cosmetic_rules.json': '{}',
    'LICENSE': 'MIT',
    'content/main.js': "chrome.runtime.getURL('fonts/test.woff2');",
    'content/main.css': 'body { color: red; }',
    'popup/popup.html': '<link href="popup.css" rel="stylesheet"><img src="../icons/icon.png"><script src="popup.js"></script>',
    'popup/popup.css': "@font-face { font-family: Example; src: url('../fonts/test.woff2'); }",
    'popup/popup.js': 'const ready = true;',
    'fonts/test.woff2': 'font fixture',
    'icons/icon.png': 'icon fixture',
    'README.md': 'Development documentation must not be installed',
    'secret.local': 'Development-only file'
  };
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(directory, name), text);
  fs.mkdirSync(path.join(directory, '.git'));
  fs.writeFileSync(path.join(directory, '.git', 'test'), 'Repository metadata');
  return directory;
}

function fileMap(directory) {
  const result = {};
  const walk = (base) => {
    for (const entry of fs.readdirSync(base)) {
      const file = path.join(base, entry);
      if (fs.lstatSync(file).isDirectory()) walk(file);
      else result[path.relative(directory, file)] = fs.readFileSync(file).toString('base64');
    }
  };
  walk(directory);
  return result;
}

test('fresh installation copies only runtime files into a stable managed directory', (t) => {
  const root = sandbox(t);
  const source = fixture(path.join(root, 'source'));
  const target = path.join(root, 'stable', 'Rastin-RTL');
  const result = installExtension({ source, target });
  assert.equal(result.updated, false);
  assert.equal(result.backup, null);
  assert.equal(result.target, target);
  assert.equal(validateRuntime(target).manifest.name, 'Rastin RTL');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(target, '.rastin-install.json'))), { product: 'Rastin-RTL', format: 1 });
  for (const omitted of ['README.md', 'secret.local', '.git', 'bin', 'node_modules']) assert.equal(fs.existsSync(path.join(target, omitted)), false);
});

test('managed updates keep the same directory and replace the full payload', (t) => {
  const root = sandbox(t);
  const source = fixture(path.join(root, 'source'));
  const target = path.join(root, 'installed');
  installExtension({ source, target });
  fs.writeFileSync(path.join(target, 'content', 'obsolete.js'), 'old');
  fs.writeFileSync(path.join(source, 'content', 'main.js'), 'const updated = true;');
  const result = installExtension({ source, target });
  assert.equal(result.updated, true);
  assert.equal(result.backup, null);
  assert.equal(fs.readFileSync(path.join(target, 'content', 'main.js'), 'utf8'), 'const updated = true;');
  assert.equal(fs.existsSync(path.join(target, 'content', 'obsolete.js')), false);
  assert.ok(fs.readdirSync(root).every((entry) => !entry.includes('.stage-') && !entry.includes('.backup-')));
});

test('missing assets never modify the previous installation', (t) => {
  const root = sandbox(t);
  const source = fixture(path.join(root, 'source'));
  const target = path.join(root, 'installed');
  installExtension({ source, target });
  const previous = fileMap(target);
  fs.rmSync(path.join(source, 'fonts', 'test.woff2'));
  assert.throws(() => installExtension({ source, target }), /Missing runtime assets|Missing referenced runtime asset/);
  assert.deepEqual(fileMap(target), previous);
  assert.ok(fs.readdirSync(root).every((entry) => !entry.includes('.stage-') && !entry.includes('.backup-')));
});

test('failed activation restores the previous directory and removes its staging folder', (t) => {
  const root = sandbox(t);
  const source = fixture(path.join(root, 'source'));
  const target = path.join(root, 'installed');
  installExtension({ source, target });
  const previous = fileMap(target);
  fs.writeFileSync(path.join(source, 'content', 'main.js'), 'const updated = true;');
  const originalRename = fs.renameSync;
  let simulatedFailure = false;
  try {
    fs.renameSync = (from, to) => {
      if (from.includes('.stage-') && to === target) {
        simulatedFailure = true;
        throw new Error('Simulated directory lock');
      }
      return originalRename(from, to);
    };
    assert.throws(() => installExtension({ source, target }), /Simulated directory lock/);
  } finally { fs.renameSync = originalRename; }
  assert.equal(simulatedFailure, true);
  assert.deepEqual(fileMap(target), previous);
  assert.ok(fs.readdirSync(root).every((entry) => !entry.includes('.stage-') && !entry.includes('.backup-')));
});

test('paths with spaces, apostrophes and Persian characters work without shell interpolation', (t) => {
  const root = sandbox(t);
  const source = fixture(path.join(root, "Ali's سورس files"));
  const target = path.join(root, "Ali's نصب files");
  assert.equal(installExtension({ source, target }).target, target);
  assert.equal(fs.readFileSync(path.join(target, 'fonts', 'test.woff2'), 'utf8'), 'font fixture');
});

test('custom unmanaged directories and invalid markers are preserved', (t) => {
  const root = sandbox(t);
  const source = fixture(path.join(root, 'source'));
  const target = fixture(path.join(root, 'existing'));
  const previous = fileMap(target);
  assert.throws(() => installExtension({ source, target }), /not managed/);
  assert.deepEqual(fileMap(target), previous);
  fs.writeFileSync(path.join(target, '.rastin-install.json'), '{"product":"Other","format":1}');
  const marked = fileMap(target);
  assert.throws(() => installExtension({ source, target }), /not managed/);
  assert.deepEqual(fileMap(target), marked);
  fs.writeFileSync(path.join(target, '.rastin-install.json'), '{invalid');
  assert.throws(() => installExtension({ source, target }), /marker is invalid/);
});

test('legacy installation at the default path is adopted with a complete retained backup', (t) => {
  const root = sandbox(t);
  const source = fixture(path.join(root, 'source'));
  const target = fixture(path.join(root, 'legacy-default'));
  const previous = fileMap(target);
  const result = installExtension({ source, target, defaultTarget: target });
  assert.equal(result.updated, true);
  assert.ok(result.backup);
  assert.deepEqual(fileMap(result.backup), previous);
  assert.equal(fs.existsSync(path.join(result.backup, '.git', 'test')), true);
  assert.equal(fs.existsSync(path.join(target, '.git')), false);
});

test('invalid legacy default directory is never replaced', (t) => {
  const root = sandbox(t);
  const source = fixture(path.join(root, 'source'));
  const target = path.join(root, 'legacy-default');
  fs.mkdirSync(target);
  fs.writeFileSync(path.join(target, 'important.txt'), 'Keep this');
  assert.throws(() => installExtension({ source, target, defaultTarget: target }), /not a valid legacy/);
  assert.deepEqual(fileMap(target), { 'important.txt': Buffer.from('Keep this').toString('base64') });
});

test('source and installation overlap are rejected', (t) => {
  const root = sandbox(t);
  const source = fixture(path.join(root, 'source'));
  for (const target of [source, path.join(source, 'installed'), root]) {
    assert.throws(() => installExtension({ source, target }), /must not overlap/);
  }
  assert.throws(() => installExtension({ source, target: path.parse(source).root }), /dedicated extension folder/);
});

test('manifest, HTML, CSS, importScripts, literal getURL and JSON assets are validated', (t) => {
  const root = sandbox(t);
  const source = fixture(path.join(root, 'source'));
  const cases = [
    ['popup/popup.html', '<script src="missing.js"></script>'],
    ['popup/popup.css', "@font-face { src: url('../fonts/missing.woff2'); }"],
    ['popup/popup.css', "@import 'missing.css';"],
    ['background.js', "importScripts('content/missing.js');"],
    ['content/main.js', "browser.runtime.getURL('icons/missing.png');"],
    ['cosmetic_rules.json', '{bad json']
  ];
  for (const [file, invalid] of cases) {
    const absolute = path.join(source, file);
    const previous = fs.readFileSync(absolute);
    fs.writeFileSync(absolute, invalid);
    assert.throws(() => validateRuntime(source), /Missing referenced runtime asset|JSON/);
    fs.writeFileSync(absolute, previous);
  }
  const manifest = JSON.parse(fs.readFileSync(path.join(source, 'manifest.json')));
  manifest.background.service_worker = '../outside.js';
  fs.writeFileSync(path.join(source, 'manifest.json'), JSON.stringify(manifest));
  assert.throws(() => validateRuntime(source), /escapes extension directory/);
});

test('dynamic URL construction is not mistaken for a literal resource', (t) => {
  const root = sandbox(t);
  const source = fixture(path.join(root, 'source'));
  fs.writeFileSync(path.join(source, 'content', 'main.js'), "const font = chrome.runtime.getURL('fonts/' + name + '.woff2');");
  assert.doesNotThrow(() => validateRuntime(source));
});

test('symbolic links and junctions are rejected for source, targets and ancestors', (t) => {
  const root = sandbox(t);
  const source = fixture(path.join(root, 'source'));
  const linked = path.join(root, 'source-link');
  try { fs.symlinkSync(source, linked, process.platform === 'win32' ? 'junction' : 'dir'); } catch (error) {
    if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) return t.skip('Creating filesystem links is unavailable.');
    throw error;
  }
  assert.throws(() => installExtension({ source: linked, target: path.join(root, 'output') }), /links and junctions/);
  assert.throws(() => installExtension({ source, target: path.join(linked, 'output') }), /must not overlap|links and junctions/);
  fs.symlinkSync(path.join(source, 'icons'), path.join(source, 'content', 'linked-icons'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => validateRuntime(source), /links and junctions/);
});

test('default directory locations and argument validation are deterministic', () => {
  const home = path.join(workspace, 'logs', 'fake-home');
  assert.equal(defaultInstallDirectory({ platform: 'win32', env: { LOCALAPPDATA: home }, home }), path.join(home, 'Rastin-RTL'));
  assert.equal(defaultInstallDirectory({ platform: 'darwin', env: {}, home }), path.join(home, 'Library', 'Application Support', 'Rastin-RTL'));
  assert.equal(defaultInstallDirectory({ platform: 'linux', env: { XDG_DATA_HOME: home }, home }), path.join(home, 'rastin-rtl'));
  assert.equal(defaultInstallDirectory({ platform: 'linux', env: {}, home }), path.join(home, '.local', 'share', 'rastin-rtl'));
  assert.equal(parseArgs(['--browser', 'edge', '--no-open']).browser, 'edge');
  assert.equal(parseArgs(['--help']).help, true);
  assert.throws(() => parseArgs(['--browser', 'firefox']), /Unsupported browser/);
  assert.throws(() => parseArgs(['--source']), /Missing value/);
  assert.throws(() => parseArgs(['--unknown']), /Unknown option/);
});

test('CLI help does not install and no-open avoids browser, clipboard and folder helpers', (t) => {
  const root = sandbox(t);
  const source = fixture(path.join(root, "source's files"));
  const target = path.join(root, "destination's files");
  const env = { ...process.env, LOCALAPPDATA: path.join(root, 'appdata'), XDG_DATA_HOME: path.join(root, 'data'), PATH: '' };
  const cli = path.join(workspace, 'bin', 'cli.js');
  const help = spawnSync(process.execPath, [cli, '--help', '--dir', target], { env, encoding: 'utf8', windowsHide: true });
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /Load unpacked/);
  assert.equal(fs.existsSync(target), false);
  assert.equal(fs.existsSync(path.join(root, 'appdata')), false);
  const installed = spawnSync(process.execPath, [cli, '--source', source, '--dir', target, '--browser', 'edge', '--no-open'], { env, encoding: 'utf8', windowsHide: true });
  assert.equal(installed.status, 0, installed.stderr);
  assert.match(installed.stdout, /installed at/);
  assert.match(installed.stdout, /Developer mode/);
  assert.doesNotMatch(installed.stdout, /Clipboard|clipboard|Requested|not found|Could not open/);
  assert.equal(validateRuntime(target).manifest.name, 'Rastin RTL');
  assert.equal(fs.existsSync(path.join(root, 'appdata')), false);
});

test('manifest versions follow Chromium component limits and failed versions preserve installed files', (t) => {
  const root = sandbox(t);
  const source = fixture(path.join(root, 'source'));
  const target = path.join(root, 'installed');
  installExtension({ source, target });
  const previous = fileMap(target);
  const file = path.join(source, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(file));
  for (const version of ['0', '0.0.0.0', '01.2', '1.00', '1.2.3.4.5', '65536', '1.2.-1', '1.2beta', '', 1]) {
    manifest.version = version;
    fs.writeFileSync(file, JSON.stringify(manifest));
    assert.throws(() => installExtension({ source, target }), /valid Rastin RTL Manifest V3/);
    assert.deepEqual(fileMap(target), previous);
  }
  for (const version of ['1', '0.0.0.1', '65535.0.1.2']) {
    manifest.version = version;
    fs.writeFileSync(file, JSON.stringify(manifest));
    assert.equal(validateRuntime(source).manifest.version, version);
  }
});