#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Build the jobspy Python venv with an interpreter that satisfies
// python-jobspy's `>=3.10` floor.
//
// Stock macOS `python3` is the Xcode Command Line Tools build (3.9.6), which is
// below that floor — so `pip install python-jobspy` fails with the unhelpful
// "No matching distribution found" / "from versions: none". We probe for a real
// 3.10+ interpreter first, rebuild a stale venv left by a failed run, upgrade
// the (often ancient) bundled pip, then install the batch requirements.

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const VENV = join(ROOT, 'batch', 'jobspy-env');
const REQUIREMENTS = join(ROOT, 'batch', 'requirements.txt');
const MIN = [3, 10];

// Most-specific names first so we prefer a real 3.10+ over a bare `python3`
// that may resolve to the 3.9 CLT build.
const CANDIDATES = ['python3.13', 'python3.12', 'python3.11', 'python3.10', 'python3', 'python'];

/** Return [major, minor] for an interpreter, or null if it can't be run. */
function versionOf(bin) {
  const res = spawnSync(bin, ['-c', 'import sys; print("%d.%d" % sys.version_info[:2])'], {
    encoding: 'utf-8',
  });
  if (res.status !== 0 || !res.stdout) return null;
  const [maj, min] = res.stdout.trim().split('.').map(Number);
  if (Number.isNaN(maj) || Number.isNaN(min)) return null;
  return [maj, min];
}

function satisfies(version) {
  if (!version) return false;
  const [maj, min] = version;
  return maj > MIN[0] || (maj === MIN[0] && min >= MIN[1]);
}

/** First interpreter on PATH that satisfies the version floor, or null. */
export function findPython() {
  for (const bin of CANDIDATES) {
    const version = versionOf(bin);
    if (satisfies(version)) return { bin, version: version.join('.') };
  }
  return null;
}

function run(bin, args, label) {
  const res = spawnSync(bin, args, { cwd: ROOT, stdio: 'inherit' });
  if (res.status !== 0) {
    console.error(`\n✗ ${label} failed (exit ${res.status ?? 'signal'}).`);
    process.exit(res.status || 1);
  }
}

function brewAvailable() {
  return spawnSync('brew', ['--version'], { encoding: 'utf-8' }).status === 0;
}

// The Homebrew formula that gives us a 3.10+ interpreter. We intentionally do
// NOT brew-install Node here: it's already present (it's running this script),
// and a second brew Node can shadow an nvm Node with a mismatched arch.
function tryBrewInstallPython() {
  if (!brewAvailable()) return null;
  console.log('→ No Python 3.10+ found — installing python@3.12 via Homebrew…');
  const res = spawnSync('brew', ['install', 'python@3.12'], { cwd: ROOT, stdio: 'inherit' });
  if (res.status !== 0) {
    console.error('✗ `brew install python@3.12` failed.');
    return null;
  }
  return findPython();
}

/**
 * Provision the jobspy venv end-to-end. Returns the chosen interpreter, or
 * throws an Error with an actionable message if no Python 3.10+ is available.
 * Exported so the setup wizard can call it inside a spinner.
 */
export function setupJobspyVenv() {
  let py = findPython();
  if (!py) py = tryBrewInstallPython();
  if (!py) {
    throw new Error(
      'Could not find or install Python 3.10+. Install Homebrew then re-run `npm run setup`:\n' +
        '  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"\n' +
        'or install Python 3.10+ directly: https://www.python.org/downloads/',
    );
  }

  const venvPy = join(VENV, 'bin', 'python');
  let needCreate = !existsSync(venvPy);
  if (!needCreate && !satisfies(versionOf(venvPy))) {
    rmSync(VENV, { recursive: true, force: true });
    needCreate = true;
  }
  if (needCreate) run(py.bin, ['-m', 'venv', VENV], 'Creating venv');
  run(venvPy, ['-m', 'pip', 'install', '--quiet', '--upgrade', 'pip'], 'Upgrading pip');
  run(venvPy, ['-m', 'pip', 'install', '-r', REQUIREMENTS], 'Installing batch requirements');
  patchJobspyTlsClient(venvPy);
  return { pythonBin: py.bin, version: py.version };
}

/**
 * python-jobspy depends on `tls-client`, which ships a prebuilt
 * `tls-client-arm64.dylib` that the macOS 26+/27 dyld rejects
 * ("chained fixups, seg_count does not match number of segments"). The
 * module-level `import tls_client` + `class TLSRotating(tls_client.Session)`
 * in jobspy/util.py make that dylib load on plain `import jobspy`, so the
 * scanner dies before scraping anything. sur9e scans LinkedIn only, which
 * uses `is_tls=False` and never needs tls_client — so we defer the import
 * and the TLSRotating subclass into create_session's `is_tls` branch. A real
 * is_tls=True caller still gets the original (clear) dylib error.
 *
 * Idempotent and non-fatal: re-running is a no-op, and an upstream refactor
 * that moves the markers just logs a warning instead of breaking setup.
 */
function patchJobspyTlsClient(venvPy) {
  // jobspy may legitimately fail to `import` here (that's the bug we're
  // fixing), so resolve util.py from the venv layout, not an import probe.
  const utilPath = join(
    VENV,
    'lib',
    spawnSync(venvPy, ['-c', 'import sys; print("python%d.%d" % sys.version_info[:2])'], {
      encoding: 'utf-8',
    }).stdout?.trim() || 'python3.13',
    'site-packages',
    'jobspy',
    'util.py',
  );
  if (!existsSync(utilPath)) return; // jobspy not where expected — leave it.
  let src = readFileSync(utilPath, 'utf-8');
  if (!src.includes('\nimport tls_client\n')) return; // already patched.

  const classBlock = `class TLSRotating(RotatingProxySession, tls_client.Session):
    def __init__(self, proxies=None):
        RotatingProxySession.__init__(self, proxies=proxies)
        tls_client.Session.__init__(self, random_tls_extension_order=True)

    def execute_request(self, *args, **kwargs):
        if self.proxy_cycle:
            next_proxy = next(self.proxy_cycle)
            if next_proxy["http"] != "http://localhost":
                self.proxies = next_proxy
            else:
                self.proxies = {}
        response = tls_client.Session.execute_request(self, *args, **kwargs)
        response.ok = response.status_code in range(200, 400)
        return response


`;
  const lazyBranch = `    if is_tls:
        # sur9e macOS-dyld patch (setup-jobspy.mjs): defer tls_client so a
        # LinkedIn-only (is_tls=False) scan imports jobspy without loading
        # its incompatible prebuilt dylib.
        import tls_client

        class TLSRotating(RotatingProxySession, tls_client.Session):
            def __init__(self, proxies=None):
                RotatingProxySession.__init__(self, proxies=proxies)
                tls_client.Session.__init__(self, random_tls_extension_order=True)

            def execute_request(self, *args, **kwargs):
                if self.proxy_cycle:
                    next_proxy = next(self.proxy_cycle)
                    if next_proxy["http"] != "http://localhost":
                        self.proxies = next_proxy
                    else:
                        self.proxies = {}
                response = tls_client.Session.execute_request(self, *args, **kwargs)
                response.ok = response.status_code in range(200, 400)
                return response

        session = TLSRotating(proxies=proxies)
`;
  const oldBranch = '    if is_tls:\n        session = TLSRotating(proxies=proxies)\n';
  if (!src.includes(classBlock) || !src.includes(oldBranch)) {
    console.warn(
      '⚠ jobspy/util.py layout changed — skipping the tls_client defer patch.\n' +
        '  If `npm run scan` fails with a tls-client dylib error, report it.',
    );
    return;
  }
  src = src
    .replace('\nimport tls_client\n', '\n')
    .replace(classBlock, '')
    .replace(oldBranch, lazyBranch);
  writeFileSync(utilPath, src, 'utf-8');
  console.log('→ Patched jobspy/util.py (deferred tls_client for macOS dyld compat).');
}

function main() {
  try {
    const { pythonBin, version } = setupJobspyVenv();
    console.log(`✓ jobspy venv ready (using ${pythonBin}, Python ${version})`);
  } catch (err) {
    console.error(`\n✗ ${err.message}\n`);
    process.exit(1);
  }
}

// Run only when invoked directly (npm run setup), not when imported by doctor.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
