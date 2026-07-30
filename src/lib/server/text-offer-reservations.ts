import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const LOCK_TIMEOUT_MS = 10_000;
const LOCK_POLL_MS = 25;
const waitBuffer = new Int32Array(new SharedArrayBuffer(4));

function reservationsDir(root: string): string {
  return join(root, 'data', 'text-offer-reservations');
}

function reservationPath(root: string, jdHash: string): string {
  return join(reservationsDir(root), `${jdHash}.json`);
}

function withLock<T>(root: string, name: string, operation: () => T): T {
  const dir = reservationsDir(root);
  const lock = join(dir, `.${name}.lock`);
  mkdirSync(dir, { recursive: true });
  const startedAt = Date.now();
  while (true) {
    try {
      mkdirSync(lock);
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      if (Date.now() - startedAt >= LOCK_TIMEOUT_MS) {
        throw new Error('timed out reserving an offer number');
      }
      Atomics.wait(waitBuffer, 0, 0, LOCK_POLL_MS);
    }
  }
  try {
    return operation();
  } finally {
    rmSync(lock, { recursive: true, force: true });
  }
}

function readReservation(root: string, jdHash: string): number | null {
  try {
    const parsed = JSON.parse(readFileSync(reservationPath(root, jdHash), 'utf-8')) as {
      num?: unknown;
    };
    return Number.isInteger(parsed.num) && Number(parsed.num) > 0 ? Number(parsed.num) : null;
  } catch {
    return null;
  }
}

export function reserveTextOfferNumber(root: string, jdHash: string, minimumNext: number): number {
  return withLock(root, 'allocation', () => {
    const existing = readReservation(root, jdHash);
    if (existing !== null) return existing;

    const reserved = new Set<number>();
    for (const name of readdirSync(reservationsDir(root))) {
      if (!name.endsWith('.json')) continue;
      try {
        const value = JSON.parse(readFileSync(join(reservationsDir(root), name), 'utf-8')) as {
          num?: unknown;
        };
        if (Number.isInteger(value.num) && Number(value.num) > 0) {
          reserved.add(Number(value.num));
        }
      } catch {
        // A damaged reservation cannot safely contribute a number.
      }
    }

    let num = minimumNext;
    while (reserved.has(num)) num += 1;
    writeFileSync(
      reservationPath(root, jdHash),
      JSON.stringify({ jdHash, num, createdAt: new Date().toISOString() }, null, 2),
      'utf-8',
    );
    return num;
  });
}

export function releaseTextOfferNumber(root: string, jdHash: string, num: number): void {
  withLock(root, 'allocation', () => {
    if (readReservation(root, jdHash) === num) {
      rmSync(reservationPath(root, jdHash), { force: true });
    }
  });
}

export function withTextOfferCreationLock<T>(root: string, operation: () => T): T {
  return withLock(root, 'creation', operation);
}
