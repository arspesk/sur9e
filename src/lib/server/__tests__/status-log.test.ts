import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  appendTransition,
  lastLoggedStatus,
  loadStatusLog,
  reconcileStatusLog,
} from '../status-log';

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'status-log-'));
  mkdirSync(join(root, 'data'), { recursive: true });
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const T0 = '2026-06-01T10:00:00.000Z';
const T1 = '2026-06-05T10:00:00.000Z';

describe('appendTransition / loadStatusLog', () => {
  it('round-trips transitions oldest-first', () => {
    appendTransition(root, { num: 7, from: null, to: 'evaluated', at: T0, source: 'app' });
    appendTransition(root, { num: 7, from: 'evaluated', to: 'applied', at: T1, source: 'app' });
    const log = loadStatusLog(root);
    expect(log).toHaveLength(2);
    expect(log[0].to).toBe('evaluated');
    expect(log[1].from).toBe('evaluated');
  });

  it('skips malformed lines instead of failing the whole log', () => {
    appendTransition(root, { num: 7, from: null, to: 'applied', at: T0, source: 'app' });
    const p = join(root, 'data/status-log.jsonl');
    writeFileSync(p, `${readFileSync(p, 'utf-8')}{truncated garbage\n`, 'utf-8');
    appendTransition(root, { num: 8, from: null, to: 'screened', at: T1, source: 'app' });
    const log = loadStatusLog(root);
    expect(log.map(t => t.num)).toEqual([7, 8]);
  });

  it('missing file → empty log', () => {
    expect(loadStatusLog(root)).toEqual([]);
  });

  it('rejects schema-invalid entries loudly', () => {
    expect(() =>
      appendTransition(root, {
        num: 7,
        from: null,
        // @ts-expect-error — invalid status must throw, not write
        to: 'ghosted',
        at: T0,
        source: 'app',
      }),
    ).toThrow();
  });
});

describe('reconcileStatusLog', () => {
  const now = () => T1;

  it('seeds never-logged offers with from=null reconciled lines', () => {
    const appended = reconcileStatusLog(root, [{ num: 1, status: 'applied' }], now);
    expect(appended).toEqual([{ num: 1, from: null, to: 'applied', at: T1, source: 'reconciled' }]);
  });

  it('heals drift from the last logged status', () => {
    appendTransition(root, { num: 1, from: null, to: 'applied', at: T0, source: 'app' });
    const appended = reconcileStatusLog(root, [{ num: 1, status: 'rejected' }], now);
    expect(appended).toHaveLength(1);
    expect(appended[0]).toMatchObject({ from: 'applied', to: 'rejected', source: 'reconciled' });
  });

  it('is a no-op when the log tail matches', () => {
    appendTransition(root, { num: 1, from: null, to: 'applied', at: T0, source: 'app' });
    expect(reconcileStatusLog(root, [{ num: 1, status: 'applied' }], now)).toEqual([]);
    expect(loadStatusLog(root)).toHaveLength(1);
  });

  it('lastLoggedStatus reflects the latest write per num', () => {
    appendTransition(root, { num: 1, from: null, to: 'applied', at: T0, source: 'app' });
    appendTransition(root, { num: 1, from: 'applied', to: 'rejected', at: T1, source: 'app' });
    expect(lastLoggedStatus(loadStatusLog(root)).get(1)).toBe('rejected');
  });
});
