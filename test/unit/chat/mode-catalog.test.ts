import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CHAT_DISCOVERABLE_MODES,
  JOB_MODE_IDS,
  MODE_ALIASES,
  MODE_CATALOG,
  resolveModeId,
} from '@/lib/modes/catalog';
import { JOB_TYPES } from '@/lib/schemas/jobs';

const ROOT = process.cwd();

describe('mode catalog', () => {
  it('classifies every public content mode exactly once', () => {
    const files = readdirSync(join(ROOT, 'content', 'modes'))
      .filter(name => name.endsWith('.md') && name !== '_shared.md')
      .map(name => name.replace(/\.md$/, ''))
      .sort();

    expect(
      Object.keys(MODE_CATALOG)
        .filter(id => id !== 'screen-evaluate' && id !== 'scan')
        .sort(),
    ).toEqual(files);
    for (const mode of Object.values(MODE_CATALOG)) {
      expect(['background', 'inline', 'handoff', 'composite']).toContain(mode.execution);
    }
  });

  it('resolves every legacy alias to a canonical mode', () => {
    for (const [alias, canonical] of Object.entries(MODE_ALIASES)) {
      expect(MODE_CATALOG[canonical]).toBeDefined();
      expect(resolveModeId(alias)).toBe(canonical);
    }
    expect(resolveModeId('outreach')).toBe('reach-out');
    expect(resolveModeId('not-a-mode')).toBeNull();
  });

  it('makes every canonical mode discoverable in chat', () => {
    expect(CHAT_DISCOVERABLE_MODES.map(mode => mode.id).sort()).toEqual(
      Object.keys(MODE_CATALOG).sort(),
    );
  });

  it('gives every canonical mode an MCP execution path', () => {
    for (const mode of Object.values(MODE_CATALOG)) {
      if (mode.execution === 'background') {
        expect(mode.singleJob, `${mode.id} must route through start_job/start_workflow`).toBe(true);
      } else if (mode.execution === 'composite') {
        expect(
          mode.expandsTo?.length,
          `${mode.id} must route through start_workflow`,
        ).toBeGreaterThan(0);
        for (const step of mode.expandsTo ?? []) {
          const expanded = MODE_CATALOG[step as keyof typeof MODE_CATALOG];
          expect(expanded, `${mode.id} -> ${step}`).toBeDefined();
          expect(expanded?.execution, `${mode.id} -> ${step} must be a background mode`).toBe(
            'background',
          );
          expect(expanded?.singleJob, `${mode.id} -> ${step} must route through start_job`).toBe(
            true,
          );
        }
      } else {
        expect(['inline', 'handoff']).toContain(mode.execution);
      }
    }
  });

  it('marks composites and report dependencies explicitly', () => {
    expect(MODE_CATALOG['screen-evaluate'].expandsTo).toEqual(['screen', 'evaluate']);
    expect(MODE_CATALOG['evaluate-offer'].expandsTo).toEqual(['screen', 'evaluate']);
    expect(MODE_CATALOG['process-queue'].expandsTo).toEqual(['screen']);
    expect(MODE_CATALOG.research.requiresEvaluation).toBe(true);
    expect(MODE_CATALOG['tailor-cv'].requiresEvaluation).toBe(true);
  });

  it('derives the persisted job schema from catalog single-job declarations', () => {
    expect([...JOB_TYPES].sort()).toEqual([...JOB_MODE_IDS].sort());
    expect(JOB_MODE_IDS).toContain('screen-evaluate');
    expect(JOB_MODE_IDS).not.toContain('evaluate-offer');
  });
});
