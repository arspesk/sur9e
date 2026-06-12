import { describe, expect, it } from 'vitest';
import { JobParams } from '@/lib/schemas/jobs';

// Regression: a `screen` job must NOT be valid with neither a url nor an
// explicit queue:true flag. Previously the api/jobs/screen route inferred
// queue mode from a missing url, so a malformed/empty body silently spawned
// a real background job over the user's pipeline. Queue mode is now an
// explicit opt-in and the schema enforces the same invariant.
describe('JobParams — screen variant', () => {
  it('accepts an offer-scoped screen with a valid url', () => {
    const r = JobParams.safeParse({ type: 'screen', url: 'https://example.com/job/1' });
    expect(r.success).toBe(true);
  });

  it('accepts queue mode when queue:true is set explicitly', () => {
    const r = JobParams.safeParse({ type: 'screen', queue: true });
    expect(r.success).toBe(true);
  });

  it('rejects a screen job with neither url nor queue:true', () => {
    const r = JobParams.safeParse({ type: 'screen' });
    expect(r.success).toBe(false);
  });

  it('rejects a screen job carrying an unrelated field but no url/queue', () => {
    const r = JobParams.safeParse({ type: 'screen', foo: 1 });
    expect(r.success).toBe(false);
  });

  it('rejects an invalid (non-url) string url', () => {
    const r = JobParams.safeParse({ type: 'screen', url: 'not-a-url' });
    expect(r.success).toBe(false);
  });

  it('does not treat queue:false as opting into queue mode', () => {
    const r = JobParams.safeParse({ type: 'screen', queue: false });
    expect(r.success).toBe(false);
  });
});
