import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MODE_RUNNER_MODE_IDS } from '../batch/mode-runner.mjs';

const catalog = JSON.parse(
  readFileSync(join(process.cwd(), 'src/lib/modes/catalog.json'), 'utf-8'),
);

describe('mode-runner catalog parity', () => {
  it('has one executable spec for every offer-scoped LLM background job', () => {
    const expected = Object.entries(catalog.modes)
      .filter(
        ([id, mode]) =>
          mode.execution === 'background' && mode.scope === 'offer' && id !== 'screen',
      )
      .map(([id]) => id)
      .sort();

    expect([...MODE_RUNNER_MODE_IDS].sort()).toEqual(expected);
  });
});
