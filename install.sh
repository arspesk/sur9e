#!/usr/bin/env bash
# sur9e — one-line installer
# Usage:  bash -c "$(curl -fsSL https://sur9e.com/install)"
#
# Thin, auditable front-door: it checks prerequisites, clones the repo, and
# hands off to the real setup wizard (scripts/setup.mjs). No setup logic lives
# here — read scripts/setup.mjs to see what the wizard does.
set -euo pipefail

REPO="https://github.com/arspesk/sur9e"
DIR="sur9e"
MIN_NODE_MAJOR=20

bold() { printf '\033[1m%s\033[0m\n' "$1"; }
ok() { printf '\033[32m%s\033[0m\n' "$1"; }
warn() { printf '\033[33m%s\033[0m\n' "$1"; }
err() { printf '\033[31m%s\033[0m\n' "$1" >&2; }

bold "sur9e — your AI job-hunt command center"
echo

# ── Prerequisites: fail fast BEFORE cloning so a missing dep is a clear message
#    here, not a cryptic failure halfway through `npm install`. ──
missing=0

if ! command -v git >/dev/null 2>&1; then
  err "✗ git not found. Install it: https://git-scm.com/downloads"
  missing=1
fi

if ! command -v node >/dev/null 2>&1; then
  err "✗ Node.js not found. Install Node ${MIN_NODE_MAJOR}+: https://nodejs.org"
  missing=1
else
  node_major="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
  if [ "${node_major:-0}" -lt "$MIN_NODE_MAJOR" ]; then
    err "✗ Node $(node -v) is too old — sur9e needs Node ${MIN_NODE_MAJOR}+."
    err "    • nvm:      nvm install 22 && nvm use 22"
    err "    • download: https://nodejs.org"
    missing=1
  fi
fi

if [ "$missing" -ne 0 ]; then
  err ""
  err "Install the missing prerequisite(s) above, then re-run this command."
  exit 1
fi

# Python only powers the optional JobSpy job scanner; the wizard's venv step
# degrades gracefully without it, so warn rather than block.
if ! command -v python3 >/dev/null 2>&1; then
  warn "! Python 3 not found — the optional job scanner will be skipped."
  warn "  Install Python 3.10+ later if you want it: https://www.python.org"
  echo
fi

# ── Don't clobber an existing checkout ──
if [ -e "$DIR" ]; then
  err "✗ A './$DIR' directory already exists here."
  err "  cd into it and run:  npm run setup"
  exit 1
fi

# ── Clone (full history — update-system.mjs relies on git) + hand off ──
ok "→ Cloning $REPO …"
git clone "$REPO" "$DIR"
cd "$DIR"
echo
ok "→ Starting setup — the guided wizard takes over from here."
ok "  (Re-run anytime with:  npm run setup)"
echo
exec npm run setup
