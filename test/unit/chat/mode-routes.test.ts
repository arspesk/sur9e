import { describe, expect, it } from 'vitest';
import { GET as getMode } from '@/app/api/chat/modes/[mode]/route';
import { GET as listModes } from '@/app/api/chat/modes/route';
import { MODE_ALIASES, MODE_CATALOG } from '@/lib/modes/catalog';

describe('chat mode routes', () => {
  it('returns the complete canonical catalog and alias map', async () => {
    const response = await listModes();
    const body = await response.json();

    expect(body.modes.map((mode: { id: string }) => mode.id).sort()).toEqual(
      Object.keys(MODE_CATALOG).sort(),
    );
    expect(body.aliases).toEqual(MODE_ALIASES);
  });

  it('resolves aliases and returns canonical inline instructions', async () => {
    const response = await getMode(new Request('http://localhost/api/chat/modes/followup'), {
      params: Promise.resolve({ mode: 'followup' }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.canonicalMode).toBe('follow-up');
    expect(body.execution).toBe('inline');
    expect(body.instructions).toContain('# Mode: followup');
  });

  it('returns protected handoff guidance and rejects unknown modes', async () => {
    const apply = await getMode(new Request('http://localhost/api/chat/modes/apply'), {
      params: Promise.resolve({ mode: 'apply' }),
    });
    const missing = await getMode(new Request('http://localhost/api/chat/modes/nope'), {
      params: Promise.resolve({ mode: 'nope' }),
    });

    expect(await apply.json()).toMatchObject({
      canonicalMode: 'apply',
      execution: 'handoff',
      handoff: '/sur9e apply <offer-number>',
    });
    expect(missing.status).toBe(404);
  });

  it('loads canonical instructions for every inline and handoff mode', async () => {
    for (const mode of Object.values(MODE_CATALOG).filter(candidate =>
      ['inline', 'handoff'].includes(candidate.execution),
    )) {
      const response = await getMode(new Request(`http://localhost/api/chat/modes/${mode.id}`), {
        params: Promise.resolve({ mode: mode.id }),
      });
      const body = await response.json();

      expect(response.status, mode.id).toBe(200);
      expect(body.instructions.length, mode.id).toBeGreaterThan(100);
      if (mode.execution === 'handoff') {
        expect(body.handoff, mode.id).toMatch(/^\/sur9e /);
      }
    }
  });
});
