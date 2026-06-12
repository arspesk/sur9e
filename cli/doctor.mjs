#!/usr/bin/env node
// SPDX-License-Identifier: MIT

/**
 * doctor.mjs — Setup validation for sur9e
 * Checks all prerequisites and prints a pass/fail checklist.
 */

import { spawnSync } from 'child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { defaultConfigPath as codexConfigPath } from '../.codex/install-hook.mjs';
import { findPython } from '../scripts/setup-jobspy.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, '..');

// ANSI colors (only on TTY)
const isTTY = process.stdout.isTTY;
const green = s => (isTTY ? `\x1b[32m${s}\x1b[0m` : s);
const red = s => (isTTY ? `\x1b[31m${s}\x1b[0m` : s);
const dim = s => (isTTY ? `\x1b[2m${s}\x1b[0m` : s);

function checkNodeVersion() {
  const major = parseInt(process.versions.node.split('.')[0]);
  if (major >= 20) {
    return { pass: true, label: `Node.js >= 20 (v${process.versions.node})` };
  }
  return {
    pass: false,
    label: `Node.js >= 20 (found v${process.versions.node})`,
    fix: 'Install Node.js 20 or later from https://nodejs.org (or `nvm install 22`)',
  };
}

function checkDependencies() {
  if (existsSync(join(projectRoot, 'node_modules'))) {
    return { pass: true, label: 'Dependencies installed' };
  }
  return {
    pass: false,
    label: 'Dependencies not installed',
    fix: 'Run: npm install',
  };
}

async function checkPlaywright() {
  try {
    const { chromium } = await import('playwright');
    const execPath = chromium.executablePath();
    if (existsSync(execPath)) {
      return { pass: true, label: 'Playwright chromium installed' };
    }
    return {
      pass: false,
      label: 'Playwright chromium not installed',
      fix: 'Run: npx playwright install chromium',
    };
  } catch {
    return {
      pass: false,
      label: 'Playwright chromium not installed',
      fix: 'Run: npx playwright install chromium',
    };
  }
}

// Per-CLI capability parity: web search + fetch are native to every CLI, but
// browser rendering (SPA job descriptions, offer liveness) comes from a stdio
// Playwright MCP wired per CLI. This reports which installed CLIs have it, so
// "evaluate runs equally on claude/codex/opencode" is verifiable, not assumed.
function checkCliMcpParity() {
  const clis = [
    {
      name: 'claude',
      // Project .mcp.json ships the server; .claude/settings.json (per-user,
      // gitignored) or headless --dangerously-skip-permissions enables it.
      wired: () => readFileSafe(join(projectRoot, '.mcp.json')).includes('playwright'),
      configHint: '.mcp.json',
    },
    {
      name: 'opencode',
      wired: () => readFileSafe(join(projectRoot, 'opencode.json')).includes('playwright'),
      configHint: 'opencode.json',
    },
    {
      name: 'codex',
      // Per-machine: not tracked (sits beside the user's own Codex config).
      wired: () => readFileSafe(join(projectRoot, '.codex/config.toml')).includes('playwright'),
      configHint: '.codex/config.toml',
    },
  ];
  const installed = clis.filter(c => binOnPath(c.name));
  if (installed.length === 0) {
    return { pass: true, label: 'No agent CLI on PATH — skipping browser-MCP parity check' };
  }
  const missing = installed.filter(c => !c.wired());
  if (missing.length === 0) {
    return {
      pass: true,
      label: `Browser MCP (Playwright) wired for: ${installed.map(c => c.name).join(', ')}`,
    };
  }
  return {
    pass: false,
    label: `Browser MCP missing for: ${missing.map(c => c.name).join(', ')} (web search/fetch still work; SPA JD rendering won't)`,
    fix: missing.map(c => `Add a "playwright" MCP entry to ${c.configHint} for ${c.name}`),
  };
}

// Per-CLI usage-tracking parity: every CLI records token spend to
// data/usage.json the same way, but the WIRING differs by what each CLI
// supports. Claude wires its Stop hook through the tracked .claude/settings.json
// ($CLAUDE_PROJECT_DIR, portable). OpenCode auto-discovers the tracked
// .opencode/plugins/ plugin. Both ship and work on clone. Codex can't ship
// working repo-local hook wiring — only ~/.codex/config.toml fires hooks
// (openai/codex#17532) — so it's installed per-machine by .codex/install-hook.mjs
// (npm run setup does this for Codex users). This reports which installed CLIs
// are actually wired so a Codex user who skipped setup sees the gap.
function checkCliUsageTracking() {
  const clis = [
    {
      name: 'claude',
      wired: () =>
        readFileSafe(join(projectRoot, '.claude/settings.json')).includes('track-mode-usage'),
      fix: 'Restore the Stop hook in .claude/settings.json (track-mode-usage.mjs)',
    },
    {
      name: 'opencode',
      // Auto-discovered by OpenCode; ships tracked, no install step.
      wired: () => existsSync(join(projectRoot, '.opencode/plugins/sur9e-track-usage.js')),
      fix: 'Restore .opencode/plugins/sur9e-track-usage.js (OpenCode auto-loads it)',
    },
    {
      name: 'codex',
      // Per-machine: install-hook.mjs writes the Stop hook into the global config.
      wired: () => readFileSafe(codexConfigPath()).includes('sur9e-track-usage'),
      fix: 'Run: node .codex/install-hook.mjs (Codex fires hooks only from ~/.codex/config.toml)',
    },
  ];
  const installed = clis.filter(c => binOnPath(c.name));
  if (installed.length === 0) {
    return { pass: true, label: 'No agent CLI on PATH — skipping usage-tracking parity check' };
  }
  const missing = installed.filter(c => !c.wired());
  if (missing.length === 0) {
    return {
      pass: true,
      label: `Usage tracking wired for: ${installed.map(c => c.name).join(', ')}`,
    };
  }
  return {
    pass: false,
    label: `Usage tracking not wired for: ${missing.map(c => c.name).join(', ')} (token spend won't be recorded)`,
    fix: missing.map(c => c.fix),
  };
}

function binOnPath(bin) {
  const probe = spawnSync(process.platform === 'win32' ? 'where' : 'which', [bin], {
    encoding: 'utf-8',
  });
  return probe.status === 0;
}

function readFileSafe(p) {
  try {
    return existsSync(p) ? readFileSync(p, 'utf-8') : '';
  } catch {
    return '';
  }
}

function pyMinorOk(versionStr) {
  const [maj, min] = (versionStr || '').split('.').map(Number);
  return maj > 3 || (maj === 3 && min >= 10);
}

function checkPython() {
  // The offer scanner (npm run scan) runs in batch/jobspy-env, which needs
  // Python >= 3.10 (python-jobspy's floor). Prefer reporting on the built venv;
  // before setup, fall back to probing for an installable interpreter.
  const venvPy = join(projectRoot, 'batch', 'jobspy-env', 'bin', 'python');
  if (existsSync(venvPy)) {
    const res = spawnSync(venvPy, ['-c', 'import sys; print("%d.%d" % sys.version_info[:2])'], {
      encoding: 'utf-8',
    });
    const version = res.stdout?.trim();
    if (res.status === 0 && pyMinorOk(version)) {
      return { pass: true, label: `jobspy venv ready (Python ${version})` };
    }
    return {
      pass: false,
      label: `jobspy venv uses an unsupported Python (${version || 'unknown'})`,
      fix: 'Run: npm run setup (rebuilds the venv with Python 3.10+)',
    };
  }
  const py = findPython();
  if (py) {
    return {
      pass: true,
      label: `Python ${py.version} available — run \`npm run setup\` to build the venv`,
    };
  }
  return {
    pass: false,
    label: 'Python 3.10+ not found (needed for the job scanner)',
    fix: ['Install Python 3.10+ (macOS: brew install python@3.12)', 'Then run: npm run setup'],
  };
}

function checkCv() {
  if (existsSync(join(projectRoot, 'inputs', 'personalization', 'cv.md'))) {
    return { pass: true, label: 'inputs/personalization/cv.md found' };
  }
  return {
    pass: false,
    label: 'inputs/personalization/cv.md not found',
    fix: [
      'Create inputs/personalization/cv.md with your CV in markdown',
      'See content/examples/ for reference CVs',
    ],
  };
}

function checkProfile() {
  if (existsSync(join(projectRoot, 'inputs', 'personalization', 'profile.yml'))) {
    return { pass: true, label: 'inputs/personalization/profile.yml found' };
  }
  return {
    pass: false,
    label: 'inputs/personalization/profile.yml not found',
    fix: [
      'Run: cp content/examples/personalization/profile.yml inputs/personalization/profile.yml',
      'Then edit it with your details',
    ],
  };
}

function checkFonts() {
  const fontsDir = join(projectRoot, 'public', 'fonts');
  if (!existsSync(fontsDir)) {
    return {
      pass: false,
      label: 'public/fonts/ directory not found',
      fix: 'The public/fonts/ directory is required for PDF generation',
    };
  }
  try {
    const files = readdirSync(fontsDir);
    if (files.length === 0) {
      return {
        pass: false,
        label: 'public/fonts/ directory is empty',
        fix: 'The public/fonts/ directory must contain font files for PDF generation',
      };
    }
  } catch {
    return {
      pass: false,
      label: 'public/fonts/ directory not readable',
      fix: 'Check permissions on the public/fonts/ directory',
    };
  }
  return { pass: true, label: 'Fonts directory ready' };
}

function checkAutoDir(name) {
  const dirPath = join(projectRoot, name);
  if (existsSync(dirPath)) {
    return { pass: true, label: `${name}/ directory ready` };
  }
  try {
    mkdirSync(dirPath, { recursive: true });
    return { pass: true, label: `${name}/ directory ready (auto-created)` };
  } catch {
    return {
      pass: false,
      label: `${name}/ directory could not be created`,
      fix: `Run: mkdir ${name}`,
    };
  }
}

async function main() {
  console.log('\nsur9e doctor');
  console.log('================\n');

  const checks = [
    checkNodeVersion(),
    checkDependencies(),
    await checkPlaywright(),
    checkCliMcpParity(),
    checkCliUsageTracking(),
    checkPython(),
    checkCv(),
    checkProfile(),
    checkFonts(),
    checkAutoDir('data'),
    checkAutoDir('artifacts/output'),
    checkAutoDir('artifacts/reports'),
  ];

  let failures = 0;

  for (const result of checks) {
    if (result.pass) {
      console.log(`${green('✓')} ${result.label}`);
    } else {
      failures++;
      console.log(`${red('✗')} ${result.label}`);
      const fixes = Array.isArray(result.fix) ? result.fix : [result.fix];
      for (const hint of fixes) {
        console.log(`  ${dim('→ ' + hint)}`);
      }
    }
  }

  console.log('');
  if (failures > 0) {
    console.log(
      `Result: ${failures} issue${failures === 1 ? '' : 's'} found. Fix them and run \`npm run doctor\` again.`,
    );
    process.exit(1);
  } else {
    console.log("Result: All checks passed. You're ready to go! Run `claude` to start.");
    process.exit(0);
  }
}

main().catch(err => {
  console.error('doctor.mjs failed:', err.message);
  process.exit(1);
});
