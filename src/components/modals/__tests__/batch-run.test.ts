import { describe, expect, it } from 'vitest';
import { runForNums } from '../batch-run';

describe('runForNums', () => {
  it('counts fulfilled done=1 results and failures', async () => {
    const run = async ({ num }: Record<string, unknown>) =>
      (num as number) % 2 === 0 ? { done: 1 } : { done: 0, error: 'boom' };
    const { done, failed } = await runForNums(run, [1, 2, 3, 4]);
    expect(done).toBe(2);
    expect(failed).toBe(2);
  });

  it('treats rejected promises as failures', async () => {
    const run = async () => {
      throw new Error('spawn failed');
    };
    const { done, failed } = await runForNums(run, [1, 2]);
    expect(done).toBe(0);
    expect(failed).toBe(2);
  });

  it('defaults the payload to { num }', async () => {
    const seen: Record<string, unknown>[] = [];
    const run = async (params: Record<string, unknown>) => {
      seen.push(params);
      return { done: 1 };
    };
    await runForNums(run, [5, 6]);
    expect(seen).toEqual([{ num: 5 }, { num: 6 }]);
  });

  it('forwards a custom payload builder per offer (evaluate flags)', async () => {
    const seen: Record<string, unknown>[] = [];
    const run = async (params: Record<string, unknown>) => {
      seen.push(params);
      return { done: 1 };
    };
    const { done, failed } = await runForNums(run, [1, 2], n => ({
      num: n,
      generate_pdf: true,
    }));
    expect(done).toBe(2);
    expect(failed).toBe(0);
    expect(seen).toEqual([
      { num: 1, generate_pdf: true },
      { num: 2, generate_pdf: true },
    ]);
  });
});
