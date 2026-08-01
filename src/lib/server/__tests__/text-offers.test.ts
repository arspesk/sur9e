import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { deleteApplication } from '../applications';
import {
  createOrReuseTextOffer,
  hashJobDescription,
  normalizeJobDescription,
  reserveTextOfferPreview,
} from '../text-offers';

const TRACKER = [
  '# Applications Tracker',
  '',
  '| # | Date | Company | Role | Score | Status | PDF | Report | Notes | Posted |',
  '| - | ---- | ------- | ---- | ----- | ------ | --- | ------ | ----- | ------ |',
  '',
].join('\n');

function seedRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'sur9e-text-offer-'));
  mkdirSync(join(root, 'data'), { recursive: true });
  mkdirSync(join(root, 'artifacts/reports'), { recursive: true });
  mkdirSync(join(root, 'batch/tracker-additions'), { recursive: true });
  writeFileSync(join(root, 'data/applications.md'), TRACKER, 'utf-8');
  return root;
}

describe('text offers', () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  it('normalizes line endings and trailing whitespace before hashing', () => {
    const unix = 'Senior Engineer  \n\nBuild reliable systems.\n';
    const windows = '\r\nSenior Engineer\r\n\r\nBuild reliable systems.   \r\n\r\n';
    expect(normalizeJobDescription(unix)).toBe('Senior Engineer\n\nBuild reliable systems.');
    expect(hashJobDescription(unix)).toBe(hashJobDescription(windows));
  });

  it('saves the JD, creates a Screened/N/A report, and merges a normal tracker row', async () => {
    const root = seedRoot();
    roots.push(root);
    const created = await createOrReuseTextOffer(root, {
      company: 'Acme',
      role: 'Senior Engineer',
      text: 'Own the platform and mentor engineers.',
    });

    expect(created.reused).toBe(false);
    expect(created.offer.num).toBe(1);
    expect(created.offer.company).toBe('Acme');
    expect(created.offer.role).toBe('Senior Engineer');
    expect(existsSync(join(root, created.jdPath))).toBe(true);
    expect(readFileSync(join(root, created.jdPath), 'utf-8')).toBe(
      'Own the platform and mentor engineers.\n',
    );

    const report = readFileSync(join(root, created.offer.reportPath!), 'utf-8');
    expect(report).toContain('source_kind: text');
    expect(report).toContain(`jd_path: ${created.jdPath}`);
    expect(report).toContain(`jd_hash: ${created.jdHash}`);
    expect(report).not.toMatch(/^url:/m);
    expect(report).toContain('status: Screened');
    expect(report).toContain('score: N/A');

    const tracker = readFileSync(join(root, 'data/applications.md'), 'utf-8');
    expect(tracker).toContain('| 1 |');
    expect(tracker).toContain('| Acme | Senior Engineer | N/A | Screened |');
  });

  it('preserves a source URL while importing its fetched JD without screening', async () => {
    const root = seedRoot();
    roots.push(root);
    const created = await createOrReuseTextOffer(root, {
      company: 'Acme',
      role: 'Senior Engineer',
      url: 'https://example.com/jobs/1',
      text: 'Own the platform and mentor engineers.',
    });

    const report = readFileSync(join(root, created.offer.reportPath!), 'utf-8');
    expect(report).toContain('source_kind: url');
    expect(report).toContain('url: https://example.com/jobs/1');
    expect(report).toContain(`jd_path: ${created.jdPath}`);
    expect(report).toContain(`jd_hash: ${created.jdHash}`);
  });

  it('reuses the exact normalized JD instead of creating a duplicate offer', async () => {
    const root = seedRoot();
    roots.push(root);
    const first = await createOrReuseTextOffer(root, {
      company: 'Acme',
      role: 'Senior Engineer',
      text: 'Own the platform.\n',
    });
    const second = await createOrReuseTextOffer(root, {
      company: 'Acme Incorporated',
      role: 'Platform Lead',
      text: '\r\nOwn the platform.   \r\n',
    });

    expect(second.reused).toBe(true);
    expect(second.offer.num).toBe(first.offer.num);
    expect(readdirSync(join(root, 'inputs/jds'))).toHaveLength(1);
    expect(
      readFileSync(join(root, 'data/applications.md'), 'utf-8').match(/^\| 1 \|/gm),
    ).toHaveLength(1);
  });

  it('creates with the exact number reserved during confirmation planning', async () => {
    const root = seedRoot();
    roots.push(root);
    const preview = await reserveTextOfferPreview(root, 'Build a reliable platform.');
    const created = await createOrReuseTextOffer(root, {
      company: 'Acme',
      role: 'Platform Engineer',
      text: 'Build a reliable platform.',
      reservedNum: preview.anticipatedNum,
    });

    expect(created.offer.num).toBe(preview.anticipatedNum);
  });

  it('releases the reserved number when offer creation fails', async () => {
    const root = seedRoot();
    roots.push(root);
    const preview = await reserveTextOfferPreview(root, 'Build a reliable platform.');
    writeFileSync(join(root, 'inputs'), 'block the inputs directory', 'utf-8');

    await expect(
      createOrReuseTextOffer(root, {
        company: 'Acme',
        role: 'Platform Engineer',
        text: 'Build a reliable platform.',
        reservedNum: preview.anticipatedNum,
      }),
    ).rejects.toThrow();

    rmSync(join(root, 'inputs'), { force: true });
    const next = await reserveTextOfferPreview(root, 'Build a different reliable platform.');
    expect(next.anticipatedNum).toBe(preview.anticipatedNum);
  });

  it('uses explicit Unknown labels when identity is genuinely absent', async () => {
    const root = seedRoot();
    roots.push(root);
    const created = await createOrReuseTextOffer(root, { text: 'Build something useful.' });
    expect(created.offer.company).toBe('Unknown');
    expect(created.offer.role).toBe('Unknown role');
  });

  it('deleting the offer also removes its saved pasted JD', async () => {
    const root = seedRoot();
    roots.push(root);
    const created = await createOrReuseTextOffer(root, {
      company: 'Acme',
      role: 'Engineer',
      text: 'Build something useful.',
    });
    expect(existsSync(join(root, created.jdPath))).toBe(true);
    expect(deleteApplication(root, created.offer.num).deleted).toBe(true);
    expect(existsSync(join(root, created.jdPath))).toBe(false);
  });

  it('deleting an imported URL offer also removes its saved JD floor', async () => {
    const root = seedRoot();
    roots.push(root);
    const created = await createOrReuseTextOffer(root, {
      company: 'Acme',
      role: 'Engineer',
      url: 'https://example.com/jobs/1',
      text: 'Build something useful.',
    });
    expect(existsSync(join(root, created.jdPath))).toBe(true);
    expect(deleteApplication(root, created.offer.num).deleted).toBe(true);
    expect(existsSync(join(root, created.jdPath))).toBe(false);
  });
});
