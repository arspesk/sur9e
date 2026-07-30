import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

async function reserveInProcess(root: string, hash: string): Promise<number> {
  const tsx = join(process.cwd(), 'node_modules/.bin/tsx');
  const modulePath = join(process.cwd(), 'src/lib/server/text-offer-reservations.ts');
  const script = [
    `import { reserveTextOfferNumber } from ${JSON.stringify(modulePath)};`,
    'process.stdout.write(String(reserveTextOfferNumber(',
    'process.env.TEST_ROOT, process.env.TEST_HASH, 1)));',
  ].join('');
  const { stdout } = await execFileAsync(tsx, ['-e', script], {
    env: { ...process.env, TEST_ROOT: root, TEST_HASH: hash },
  });
  return Number(stdout);
}

describe('text offer number reservations', () => {
  it('allocates distinct numbers atomically across concurrent processes', async () => {
    const root = mkdtempSync(join(tmpdir(), 'sur9e-text-reservations-'));
    roots.push(root);

    const numbers = await Promise.all([
      reserveInProcess(root, 'a'.repeat(64)),
      reserveInProcess(root, 'b'.repeat(64)),
    ]);

    expect([...numbers].sort((a, b) => a - b)).toEqual([1, 2]);
  });

  it('reuses one reservation for concurrent requests with the same JD hash', async () => {
    const root = mkdtempSync(join(tmpdir(), 'sur9e-text-reservations-'));
    roots.push(root);

    const numbers = await Promise.all([
      reserveInProcess(root, 'c'.repeat(64)),
      reserveInProcess(root, 'c'.repeat(64)),
    ]);

    expect(numbers).toEqual([1, 1]);
  });
});
