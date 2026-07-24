import { describe, expect, it } from 'vitest';
import { formatSseEvent, heartbeatFrame, SSE_HEADERS } from '@/lib/server/chat/sse';

describe('formatSseEvent', () => {
  it('frames id + data + blank line', () => {
    const e = { seq: 3, type: 'done', messageId: 'm1' } as const;
    expect(formatSseEvent(e)).toBe(`id: 3\ndata: ${JSON.stringify(e)}\n\n`);
  });

  it('keeps multi-line text on one data line (JSON escapes newlines)', () => {
    const e = { seq: 1, type: 'text-delta', text: 'a\nb' } as const;
    expect(formatSseEvent(e).split('\n')).toHaveLength(4); // id, data, '', ''
  });
});

describe('heartbeatFrame', () => {
  it('is a comment frame ending with a blank line', () => {
    expect(heartbeatFrame().startsWith(':')).toBe(true);
    expect(heartbeatFrame().endsWith('\n\n')).toBe(true);
  });
});

describe('SSE_HEADERS', () => {
  it('carries the required stream headers', () => {
    expect(SSE_HEADERS['Content-Type']).toBe('text/event-stream');
    expect(SSE_HEADERS['Cache-Control']).toContain('no-cache');
    expect(SSE_HEADERS['X-Accel-Buffering']).toBe('no');
  });
});
