#!/usr/bin/env node
// SPDX-License-Identifier: MIT

/**
 * cv-sync-check.mjs — Validates that the sur9e setup is consistent.
 *
 * Checks:
 * 1. inputs/personalization/cv.md exists
 * 2. inputs/personalization/profile.yml exists and has required fields
 * 3. No hardcoded metrics in _shared.md or batch/batch-prompt.md
 * 4. inputs/personalization/article-digest.md freshness (if exists)
 */

import { existsSync, readFileSync, statSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, '..');

const warnings = [];
const errors = [];

// 1. Check inputs/personalization/cv.md exists
const cvPath = join(projectRoot, 'inputs', 'personalization', 'cv.md');
if (!existsSync(cvPath)) {
  errors.push('inputs/personalization/cv.md not found. Create it with your CV in markdown format.');
} else {
  const cvContent = readFileSync(cvPath, 'utf-8');
  if (cvContent.trim().length < 100) {
    warnings.push(
      'inputs/personalization/cv.md seems too short. Make sure it contains your full CV.',
    );
  }
}

// 2. Check inputs/personalization/profile.yml exists
const profilePath = join(projectRoot, 'inputs', 'personalization', 'profile.yml');
if (!existsSync(profilePath)) {
  errors.push(
    'inputs/personalization/profile.yml not found. Copy from content/examples/personalization/profile.yml and fill in your details.',
  );
} else {
  const profileContent = readFileSync(profilePath, 'utf-8');
  const requiredFields = ['full_name', 'email', 'location'];
  for (const field of requiredFields) {
    if (!profileContent.includes(field) || profileContent.includes(`"Jane Smith"`)) {
      warnings.push(
        `inputs/personalization/profile.yml may still have example data. Check field: ${field}`,
      );
      break;
    }
  }
}

// 3. Check for hardcoded metrics in prompt files
const filesToCheck = [
  { path: join(projectRoot, 'content', 'modes', '_shared.md'), name: '_shared.md' },
  { path: join(projectRoot, 'batch', 'batch-prompt.md'), name: 'batch-prompt.md' },
];

// Pattern: numbers that look like hardcoded metrics (e.g., "170+ hours", "90% self-service")
const metricPattern = /\b\d{2,4}\+?\s*(hours?|%|evals?|layers?|tests?|fields?|bases?)\b/gi;

for (const { path, name } of filesToCheck) {
  if (!existsSync(path)) continue;
  const content = readFileSync(path, 'utf-8');

  // Skip lines that are clearly instructions (contain "NEVER hardcode" etc.)
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (
      line.includes('NEVER hardcode') ||
      line.includes('NUNCA hardcode') ||
      line.startsWith('#') ||
      line.startsWith('<!--')
    )
      continue;
    const matches = line.match(metricPattern);
    if (matches) {
      warnings.push(
        `${name}:${i + 1} — Possible hardcoded metric: "${matches[0]}". Should this be read from inputs/personalization/cv.md or inputs/personalization/article-digest.md?`,
      );
    }
  }
}

// 4. Check inputs/personalization/article-digest.md freshness
const digestPath = join(projectRoot, 'inputs', 'personalization', 'article-digest.md');
if (existsSync(digestPath)) {
  const stats = statSync(digestPath);
  const daysSinceModified = (Date.now() - stats.mtimeMs) / (1000 * 60 * 60 * 24);
  if (daysSinceModified > 30) {
    warnings.push(
      `inputs/personalization/article-digest.md is ${Math.round(daysSinceModified)} days old. Consider updating if your projects have new metrics.`,
    );
  }
}

// Output results
console.log('\n=== sur9e sync check ===\n');

if (errors.length === 0 && warnings.length === 0) {
  console.log('All checks passed.');
} else {
  if (errors.length > 0) {
    console.log(`ERRORS (${errors.length}):`);
    errors.forEach(e => console.log(`  ERROR: ${e}`));
  }
  if (warnings.length > 0) {
    console.log(`\nWARNINGS (${warnings.length}):`);
    warnings.forEach(w => console.log(`  WARN: ${w}`));
  }
}

console.log('');
process.exit(errors.length > 0 ? 1 : 0);
