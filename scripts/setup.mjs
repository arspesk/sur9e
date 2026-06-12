#!/usr/bin/env node
// scripts/setup.mjs
// SPDX-License-Identifier: MIT
// Guided, idempotent setup wizard. Invoked by `npm run setup` after install.
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  cancel,
  confirm,
  intro,
  isCancel,
  log,
  note,
  outro,
  select,
  spinner,
} from '@clack/prompts';
import { install as installCodexHook } from '../.codex/install-hook.mjs';
import {
  applySettings,
  readConfig,
  seedConfigIfMissing,
  writeConfigAtomic,
} from './lib/config-writer.mjs';
import { pickModels, selectProvider } from './lib/provider-select.mjs';
import { setupJobspyVenv } from './setup-jobspy.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PERSONALIZATION = join(ROOT, 'inputs', 'personalization');
const EXAMPLES = join(ROOT, 'content', 'examples', 'personalization');
const CLI_BINARY = { claude: 'claude', codex: 'codex', opencode: 'opencode' };

// The wizard hands off to the agent by seeding a first message — a playful
// handshake the agent recognises (CLAUDE.md / AGENTS.md "Session start") as
// "the setup wizard just finished — onboard now".
// Each CLI seeds a first message differently: claude/codex take it as a
// positional prompt; opencode's positional is a project PATH, so it needs
// `--prompt` (its `run` subcommand is headless and would not stay interactive).
// We also pass `--model` so the onboarding session runs on the chosen default
// model — config.default_model only governs headless runs, so an unpinned
// launch would otherwise use the CLI's own session default, not the user's pick.
const LAUNCH_ARGS = {
  claude: (msg, model) => [...(model ? ['--model', model] : []), msg],
  codex: (msg, model) => [...(model ? ['--model', model] : []), msg],
  opencode: (msg, model) => [...(model ? ['--model', model] : []), '--prompt', msg],
};

// The handshake the wizard seeds as the agent's first message. CLAUDE.md /
// AGENTS.md teach the agent to recognise it as the wizard's launch signal.
const ONBOARDING_PHRASE = 'Set me for success, baby!';

function bail(message) {
  cancel(message);
  process.exit(1);
}
function checkCancel(value) {
  if (isCancel(value)) {
    cancel('Setup cancelled — re-run `npm run setup` anytime.');
    process.exit(0);
  }
  return value;
}

function isPlaywrightInstalled() {
  // Reuse Playwright's own resolution; if the import or binary is missing → false.
  // Uses dynamic `import('node:fs')` (not `require`) so the probe is robust even
  // if the package ever switches to "type": "module".
  const probe =
    "Promise.all([import('playwright'),import('node:fs')])" +
    '.then(([p,fs])=>process.exit(fs.existsSync(p.chromium.executablePath())?0:1))' +
    '.catch(()=>process.exit(1))';
  return spawnSync(process.execPath, ['-e', probe], { cwd: ROOT }).status === 0;
}

function runProbe() {
  const stdout = execFileSync(
    'npx',
    ['tsx', '--conditions=react-server', 'scripts/providers-probe.mjs'],
    { cwd: ROOT, encoding: 'utf-8' },
  );
  return JSON.parse(stdout);
}

async function envStep() {
  const pw = spinner();
  pw.start('Playwright Chromium');
  if (isPlaywrightInstalled()) {
    pw.stop('Playwright Chromium — already installed');
  } else {
    try {
      execFileSync('npx', ['playwright', 'install', 'chromium'], { cwd: ROOT, stdio: 'ignore' });
      pw.stop('Playwright Chromium — installed');
    } catch {
      pw.stop('Playwright Chromium — failed');
      bail('Playwright install failed. Run `npx playwright install chromium` and re-run setup.');
    }
  }

  const venv = spinner();
  venv.start('Python venv (job scanner)');
  try {
    const { pythonBin, version } = setupJobspyVenv();
    venv.stop(`Python venv ready (${pythonBin}, ${version})`);
  } catch (err) {
    venv.stop('Python venv — failed');
    bail(err.message);
  }
}

async function settingsStep() {
  seedConfigIfMissing();

  const probe = runProbe();
  const sel = selectProvider(probe);

  if (sel.installed.length === 0) {
    note(
      'No AI CLI found on this machine. Pick the one you plan to use — sur9e will\nconfigure for it now, and you can install it after setup.',
      'No CLI detected',
    );
  }

  // Always show the picker (even with a single CLI) so the user sees every
  // provider's detected status — a missing/PATH-broken CLI shows as
  // "(not installed)" rather than being silently skipped.
  const provider = checkCancel(
    await select({
      message: 'Which AI CLI should sur9e use?',
      options: sel.options.map(o => ({ value: o.id, label: o.label })),
      initialValue: sel.preselect,
    }),
  );

  const recommended = pickModels(provider, probe[provider].models);
  if (probe[provider].installed.ok && !probe[provider].authed.ok) {
    // The adapter knows the right login command per CLI (it differs: `claude`,
    // `codex login`, `opencode auth login`) — surface that, don't synthesize one.
    const hint =
      probe[provider].authed.warning ?? `Authenticate ${provider} before running a scan.`;
    note(`${provider} is installed but not authenticated.\n${hint}`, 'Heads up');
  }

  const modelOptions = probe[provider].models.map(m => ({ value: m.id, label: m.label }));
  const defaultModel = checkCancel(
    await select({
      message: 'Default model — the deep pass (evaluations and anything but screening)',
      options: modelOptions,
      initialValue: recommended.default,
    }),
  );
  const fallback = checkCancel(
    await select({
      message: 'Fallback model — retried once if the default fails',
      options: [
        { value: '', label: 'None' },
        ...modelOptions.filter(o => o.value !== defaultModel),
      ],
      initialValue: '',
    }),
  );

  const theme = checkCancel(
    await select({
      message: 'Theme',
      options: [
        { value: 'system', label: 'System (follow OS)' },
        { value: 'light', label: 'Light' },
        { value: 'dark', label: 'Dark' },
      ],
      initialValue: 'system',
    }),
  );

  // Screening stays on the cheap recommended model out of the box; onboarding
  // offers to override per-mode later. The default model powers the deep pass.
  writeConfigAtomic(
    applySettings(readConfig(), {
      theme,
      provider,
      defaultModel,
      screenModel: recommended.screen,
      fallback: fallback || null,
    }),
  );
  log.success(
    `Settings saved — ${provider}, default ${defaultModel}${fallback ? `, fallback ${fallback}` : ''}, screening ${recommended.screen}. Tune anytime in web Settings.`,
  );
  return { provider, defaultModel };
}

function seedPersonalization() {
  // Only narrative is safe to auto-seed; cv.md / profile.yml ABSENCE is the
  // agent's onboarding trigger (docs/onboarding.md Step 0) — never create them.
  // inputs/personalization/ is gitignored — absent on a fresh clone.
  mkdirSync(PERSONALIZATION, { recursive: true });
  const narrative = join(PERSONALIZATION, 'narrative.md');
  if (!existsSync(narrative) && existsSync(join(EXAMPLES, 'narrative.md'))) {
    copyFileSync(join(EXAMPLES, 'narrative.md'), narrative);
  }
  const needs = ['cv.md', 'profile.yml'].filter(f => !existsSync(join(PERSONALIZATION, f)));
  if (needs.length) {
    note(
      `Still needed: ${needs.join(', ')}.\nThe agent will set these up in onboarding.`,
      'Personalization',
    );
  }
}

async function launchStep(provider, defaultModel) {
  // Re-probe here (not reuse the settings-step result): the user may have run
  // the CLI's auth login in another terminal after seeing the "needs auth" note.
  const p = runProbe()[provider];
  const ready = p?.installed.ok && p?.authed.ok;

  if (!ready) {
    const next = !p?.installed.ok
      ? `Install ${provider} — ${p?.installHint ?? 'see its docs'} — then run \`${CLI_BINARY[provider]}\``
      : `Authenticate ${provider} (${p?.authed.warning ?? `run \`${CLI_BINARY[provider]}\``}), then run \`${CLI_BINARY[provider]}\``;
    outro(`Setup complete. ${next} to start onboarding.`);
    return;
  }
  const go = checkCancel(await confirm({ message: 'Start CV onboarding now?' }));
  if (!go) {
    outro(`Setup complete. Run \`${CLI_BINARY[provider]}\` whenever you're ready.`);
    return;
  }
  outro(`Launching ${CLI_BINARY[provider]} on ${defaultModel}…`);
  const fallbackArgs = (m, model) => (model ? ['--model', model, m] : [m]);
  const args = (LAUNCH_ARGS[provider] ?? fallbackArgs)(ONBOARDING_PHRASE, defaultModel);
  const res = spawnSync(CLI_BINARY[provider], args, { cwd: ROOT, stdio: 'inherit' });
  if (res.error)
    console.log(`\nCouldn't launch ${CLI_BINARY[provider]} — run it manually to start onboarding.`);
}

// Wire per-CLI usage tracking. Claude (.claude/settings.json) and OpenCode
// (.opencode/plugins/) ship wired and auto-load straight from the repo on
// clone. Codex can't — only the global ~/.codex/config.toml fires hooks
// (openai/codex#17532) — so we install its Stop hook into that global config
// here, per machine. Doctor's usage-tracking check reports the same state.
function wireProviderHooks(provider) {
  if (provider !== 'codex') return; // claude + opencode auto-load from the repo
  try {
    const r = installCodexHook();
    log.success(
      r.changed
        ? `Codex usage tracking wired into ${r.configPath}`
        : 'Codex usage tracking already wired.',
    );
  } catch (e) {
    log.warn(
      `Couldn't wire the Codex usage hook automatically (${e.message}).\n` +
        'Run `node .codex/install-hook.mjs` later to enable token tracking.',
    );
  }
}

async function main() {
  intro('sur9e setup');
  await envStep();
  const { provider, defaultModel } = await settingsStep();
  seedPersonalization();
  wireProviderHooks(provider);
  await launchStep(provider, defaultModel);
}

main().catch(err => {
  console.error('\nsetup failed:', err?.message ?? err);
  process.exit(1);
});
