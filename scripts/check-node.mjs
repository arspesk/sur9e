#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Fail fast (and clearly) when Node is older than sur9e's floor.
//
// Runs as the `preinstall` hook so `npm install` / `npm run setup` stop BEFORE
// doing any work on an unsupported Node, with an actionable upgrade hint —
// rather than failing deep inside a dependency build with a cryptic error.
// We can't auto-install Node (it's the runtime executing this script), so the
// best onboarding help is a precise early error.

const MIN_MAJOR = 20;
const major = Number(process.versions.node.split('.')[0]);

if (major < MIN_MAJOR) {
  console.error(
    [
      '',
      `✗ sur9e requires Node ${MIN_MAJOR}+. You are on ${process.version}.`,
      '',
      '  Upgrade, then re-run `npm run setup`:',
      '    • nvm:       nvm install 22 && nvm use 22',
      '    • Homebrew:  brew install node',
      '    • Or:        https://nodejs.org/en/download',
      '',
    ].join('\n'),
  );
  process.exit(1);
}
