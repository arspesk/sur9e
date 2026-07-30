import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const LOCK_TIMEOUT_MS = 10_000;
const LOCK_POLL_MS = 25;
const RESERVATION_TTL_MS = 30 * 60 * 1000;

function reservationsDir(root: string): string {
  return join(root, 'data', 'text-offer-reservations');
}

function reservationPath(root: string, jdHash: string): string {
  return join(reservationsDir(root), `${jdHash}.json`);
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function withLock<T>(
  root: string,
  name: string,
  operation: () => T | Promise<T>,
): Promise<T> {
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
        throw new Error(`timed out acquiring the ${name} text-offer lock`);
      }
      await delay(LOCK_POLL_MS);
    }
  }
  try {
    return await operation();
  } finally {
    rmSync(lock, { recursive: true, force: true });
  }
}

function readReservation(root: string, jdHash: string): { num: number; createdAt: string } | null {
  try {
    const parsed = JSON.parse(readFileSync(reservationPath(root, jdHash), 'utf-8')) as {
      num?: unknown;
      createdAt?: unknown;
    };
    return Number.isInteger(parsed.num) &&
      Number(parsed.num) > 0 &&
      typeof parsed.createdAt === 'string'
      ? { num: Number(parsed.num), createdAt: parsed.createdAt }
      : null;
  } catch {
    return null;
  }
}

export async function reserveTextOfferNumber(
  root: string,
  jdHash: string,
  minimumNext: number,
): Promise<number> {
  return withLock(root, 'allocation', () => {
    const existing = readReservation(root, jdHash);
    if (existing !== null && Date.now() - Date.parse(existing.createdAt) <= RESERVATION_TTL_MS) {
      return existing.num;
    }
    if (existing !== null) rmSync(reservationPath(root, jdHash), { force: true });

    const reserved = new Set<number>();
    for (const name of readdirSync(reservationsDir(root))) {
      if (!name.endsWith('.json')) continue;
      try {
        const value = JSON.parse(readFileSync(join(reservationsDir(root), name), 'utf-8')) as {
          num?: unknown;
          createdAt?: unknown;
        };
        const createdAt =
          typeof value.createdAt === 'string' ? Date.parse(value.createdAt) : Number.NaN;
        if (!Number.isFinite(createdAt) || Date.now() - createdAt > RESERVATION_TTL_MS) {
          rmSync(join(reservationsDir(root), name), { force: true });
        } else if (Number.isInteger(value.num) && Number(value.num) > 0) {
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

export async function releaseTextOfferNumber(
  root: string,
  jdHash: string,
  num: number,
): Promise<void> {
  await withLock(root, 'allocation', () => {
    if (readReservation(root, jdHash)?.num === num) {
      rmSync(reservationPath(root, jdHash), { force: true });
    }
  });
}

export function withTextOfferCreationLock<T>(
  root: string,
  operation: () => T | Promise<T>,
): Promise<T> {
  return withLock(root, 'creation', operation);
}
