#!/usr/bin/env node
// SPDX-License-Identifier: MIT
/**
 * pipeline-to-input.mjs — Populate batch/batch-input.tsv from data/pipeline.md
 *
 * Extracts `- [ ] URL | Company | Title` lines from the "## Pending" section
 * and writes them as tab-separated rows: id, url, source, notes, title, company.
 *
 * Preserves existing IDs. Appends new offers with fresh IDs. Will not add a
 * URL that's already in batch-input.tsv.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve } from 'path';

const ROOT = resolve(process.cwd());
const PIPELINE = `${ROOT}/data/pipeline.md`;
const INPUT = `${ROOT}/batch/batch-input.tsv`;

if (!existsSync(PIPELINE)) {
  console.error(`ERROR: ${PIPELINE} missing.`);
  process.exit(1);
}

mkdirSync(`${ROOT}/batch`, { recursive: true });

const HEADER = 'id\turl\tsource\tnotes\ttitle\tcompany\n';

function readExisting() {
  if (!existsSync(INPUT)) return { rows: [], urls: new Set(), maxId: 0 };
  const text = readFileSync(INPUT, 'utf-8');
  const lines = text.split('\n').filter(Boolean);
  if (lines.length === 0) return { rows: [], urls: new Set(), maxId: 0 };
  const rows = lines.slice(1); // skip header
  const urls = new Set();
  let maxId = 0;
  for (const line of rows) {
    const cols = line.split('\t');
    const id = parseInt(cols[0] || '0', 10);
    const url = cols[1] || '';
    if (url) urls.add(url);
    if (id > maxId) maxId = id;
  }
  return { rows, urls, maxId };
}

const text = readFileSync(PIPELINE, 'utf-8');
const lines = text.split('\n');

// Extract `- [ ] URL | Company | Title` lines inside ## Pending
const pendingIdx = lines.findIndex(l => /^##\s+Pending\b/.test(l));
const nextIdx = lines.findIndex((l, i) => i > pendingIdx && /^##\s/.test(l));
const pendingLines = pendingIdx >= 0
  ? lines.slice(pendingIdx + 1, nextIdx === -1 ? lines.length : nextIdx)
  : [];

const parsed = [];
for (const raw of pendingLines) {
  const m = raw.match(/^- \[ \]\s+(\S+)\s*\|\s*(.+?)\s*\|\s*(.+?)\s*$/);
  if (!m) continue;
  parsed.push({ url: m[1], company: m[2], title: m[3] });
}

const { rows: existingRows, urls: existingUrls, maxId } = readExisting();

const out = [HEADER, ...existingRows.map(r => r + '\n')];
let nextId = maxId + 1;
let added = 0;
for (const p of parsed) {
  if (existingUrls.has(p.url)) continue;
  const line = [
    nextId,
    p.url,
    'pipeline.md',
    '',
    p.title,
    p.company,
  ].map(v => String(v).replace(/\t/g, ' ').replace(/\n/g, ' ')).join('\t') + '\n';
  out.push(line);
  existingUrls.add(p.url);
  nextId++;
  added++;
}

writeFileSync(INPUT, out.join(''), 'utf-8');
console.log(`✓ ${INPUT}`);
console.log(`  previously: ${existingRows.length}`);
console.log(`  added now:  ${added}`);
console.log(`  total:      ${existingRows.length + added}`);

// Mark all parsed entries as processed in pipeline.md (whether newly added or already in batch-input)
if (parsed.length > 0) {
  let pipelineText = readFileSync(PIPELINE, 'utf-8');
  let marked = 0;
  for (const p of parsed) {
    const checkbox = `- [ ] ${p.url}`;
    if (pipelineText.includes(checkbox)) {
      pipelineText = pipelineText.replace(checkbox, `- [x] ${p.url}`);
      marked++;
    }
  }
  if (marked > 0) {
    writeFileSync(PIPELINE, pipelineText, 'utf-8');
    console.log(`  marked ${marked} entries as processed in pipeline.md`);
  }
}
