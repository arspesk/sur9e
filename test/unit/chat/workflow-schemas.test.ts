import { describe, expect, it } from 'vitest';
import { WorkflowTargetInput } from '@/lib/schemas/chat-actions';
import { WorkflowRecord, WorkflowTarget } from '@/lib/schemas/workflows';

describe('workflow schemas', () => {
  it('accepts only HTTP(S) workflow URLs', () => {
    expect(WorkflowTargetInput.safeParse({ url: 'https://example.com/jobs/1' }).success).toBe(true);
    expect(WorkflowTargetInput.safeParse({ url: 'http://example.com/jobs/1' }).success).toBe(true);
    expect(WorkflowTargetInput.safeParse({ url: 'ftp://example.com/jobs/1' }).success).toBe(false);
  });

  it('retains the source URL when a screened target also has an offer number', () => {
    expect(WorkflowTarget.parse({ url: 'https://example.com/jobs/1', num: 42 })).toEqual({
      url: 'https://example.com/jobs/1',
      num: 42,
    });
  });

  it('requires persisted workflow ids to use the generated hex shape', () => {
    expect(WorkflowRecord.shape.id.safeParse('0123456789abcdef').success).toBe(true);
    expect(WorkflowRecord.shape.id.safeParse('../../outside1234').success).toBe(false);
  });
});
