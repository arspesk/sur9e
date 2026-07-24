import { describe, expect, it, vi } from 'vitest';

const getTurn = vi.hoisted(() => vi.fn());
vi.mock('@/lib/server/chat/turn-runner', () => ({ getTurn }));

import { GET } from '@/app/api/chat/turns/[id]/route';

const params = (id: string) => ({ params: Promise.resolve({ id }) });
const TURN_ID = '11111111-2222-4333-8444-555555555555';

describe('GET /api/chat/turns/[id]', () => {
  it('rejects a non-uuid id', async () => {
    const res = await GET(new Request('http://x'), params('nope'));
    expect(res.status).toBe(400);
  });
  it('404s an unknown turn', async () => {
    getTurn.mockReturnValueOnce(null);
    const res = await GET(new Request('http://x'), params(TURN_ID));
    expect(res.status).toBe(404);
  });
  it('returns status + conversationId of a known turn', async () => {
    getTurn.mockReturnValueOnce({ status: 'running', conversationId: 'c1' });
    const res = await GET(new Request('http://x'), params(TURN_ID));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'running', conversationId: 'c1' });
  });
});
