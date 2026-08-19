// test/components/activity-stream.test.tsx
//
// The unified activity stream (issue #103 rework): one live shimmer line
// showing the real current step while the model works, one summary line at
// rest ("Worked · 41s · 9 steps [· N failed]"), the full step timeline on
// expand. Replaces ThinkingBlock + ToolCard.

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ActivityStream } from '@/features/chat/activity-stream';
import type { FoldedItem } from '@/features/chat/fold-events';

type Activity = Extract<FoldedItem, { kind: 'activity' }>;

function activity(partial: Partial<Activity>): Activity {
  return {
    kind: 'activity',
    status: 'done',
    steps: 0,
    failed: 0,
    entries: [],
    ...partial,
  };
}

describe('ActivityStream', () => {
  it('live: shows the humanized current step from the last running tool call', () => {
    render(
      <ActivityStream
        streaming
        activity={activity({
          status: 'running',
          steps: 2,
          entries: [
            { type: 'tool', name: 'get_tracker', status: 'done' },
            { type: 'tool', name: 'set_status', status: 'running', detail: '#1852 → rejected' },
          ],
        })}
      />,
    );
    expect(screen.getByText(/Setting status/)).toBeTruthy();
    expect(screen.getByText(/#1852/)).toBeTruthy();
  });

  it('live: reads "Thinking…" while the trailing entry is a thinking run', () => {
    render(
      <ActivityStream
        streaming
        activity={activity({
          status: 'running',
          entries: [{ type: 'thinking', text: 'hmm' }],
        })}
      />,
    );
    expect(screen.getByText(/Thinking…/)).toBeTruthy();
  });

  it('live: strips the MCP server prefix from tool names', () => {
    render(
      <ActivityStream
        streaming
        activity={activity({
          status: 'running',
          steps: 1,
          entries: [{ type: 'tool', name: 'mcp__sur9e-app__get_report', status: 'running' }],
        })}
      />,
    );
    expect(screen.getByText(/Reading report/)).toBeTruthy();
    expect(screen.queryByText(/mcp__/)).toBeNull();
  });

  it('settled: one summary line with duration, steps, and failure count', () => {
    render(
      <ActivityStream
        streaming={false}
        activity={activity({
          status: 'error',
          steps: 9,
          failed: 1,
          startTs: 1_000,
          endTs: 42_000,
          entries: [{ type: 'tool', name: 'set_status', status: 'error', detail: '#1907' }],
        })}
      />,
    );
    expect(screen.getByText(/Worked · 41s · 9 steps · 1 failed/)).toBeTruthy();
  });

  it('settled: omits the duration when events carry no timestamps (pre-migration)', () => {
    render(
      <ActivityStream
        streaming={false}
        activity={activity({
          status: 'done',
          steps: 3,
          entries: [{ type: 'tool', name: 'get_tracker', status: 'done' }],
        })}
      />,
    );
    expect(screen.getByText('Worked · 3 steps')).toBeTruthy();
  });

  it('expand: the timeline lists every step; a detail with a transition renders the arrow icon', () => {
    const { container } = render(
      <ActivityStream
        streaming={false}
        activity={activity({
          status: 'done',
          steps: 2,
          entries: [
            { type: 'tool', name: 'get_report', status: 'done', detail: '#1841' },
            { type: 'tool', name: 'set_status', status: 'done', detail: '#1841 → rejected' },
          ],
        })}
      />,
    );
    // The expand affordance is the Lucide list-chevrons-up-down icon.
    expect(container.querySelector('svg.lucide-list-chevrons-up-down')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Worked/ }));
    expect(screen.getByText('get_report')).toBeTruthy();
    // '#1841' appears both as a plain detail and as the arrow-split "from".
    expect(screen.getAllByText('#1841').length).toBeGreaterThan(0);
    // "#1841 → rejected" renders as from + ArrowRight icon + to.
    expect(container.querySelector('svg.lucide-arrow-right')).toBeTruthy();
    expect(screen.getByText('rejected')).toBeTruthy();
  });

  it('expand: a thinking entry is a second-level disclosure holding its text', () => {
    render(
      <ActivityStream
        streaming={false}
        activity={activity({
          status: 'done',
          steps: 1,
          entries: [
            { type: 'thinking', text: 'the actual reasoning', ts: 1_000 },
            { type: 'tool', name: 'get_tracker', status: 'done', ts: 7_000 },
          ],
        })}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Worked/ }));
    const thinkingRow = screen.getByRole('button', { name: /Thought/ });
    expect(screen.queryByText('the actual reasoning')).toBeNull();
    fireEvent.click(thinkingRow);
    expect(screen.getByText('the actual reasoning')).toBeTruthy();
  });

  it('renders thinking text as markdown, not literal asterisks', () => {
    const { container } = render(
      <ActivityStream
        streaming={false}
        activity={activity({
          status: 'done',
          steps: 1,
          entries: [
            { type: 'thinking', text: '**2 active interviews** need prep' },
            { type: 'tool', name: 'get_tracker', status: 'done' },
          ],
        })}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Worked/ }));
    fireEvent.click(screen.getByRole('button', { name: /Thought/ }));
    const strong = container.querySelector('.chat-activity__think-body strong');
    expect(strong?.textContent).toBe('2 active interviews');
    expect(screen.queryByText(/\*\*/)).toBeNull();
  });

  it('marks thinking rows with the Lightbulb icon', () => {
    const { container } = render(
      <ActivityStream
        streaming={false}
        activity={activity({
          status: 'done',
          steps: 1,
          entries: [
            { type: 'thinking', text: 'reasoning' },
            { type: 'tool', name: 'get_tracker', status: 'done' },
          ],
        })}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Worked/ }));
    expect(container.querySelector('svg.lucide-lightbulb')).toBeTruthy();
  });

  it('lights the bulb while its thought is expanded', () => {
    const { container } = render(
      <ActivityStream
        streaming={false}
        activity={activity({
          status: 'done',
          steps: 1,
          entries: [
            { type: 'thinking', text: 'reasoning' },
            { type: 'tool', name: 'get_tracker', status: 'done' },
          ],
        })}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Worked/ }));
    const lit = () =>
      container.querySelector('.chat-activity__glyph[data-open] svg.lucide-lightbulb');
    expect(lit()).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Thought/ }));
    expect(lit()).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Thought/ }));
    expect(lit()).toBeNull();
  });

  it('keeps a tool detail hugging its name in one cell (no shared name column)', () => {
    // A burst mixing a short and a long tool name: with a shared `auto` name
    // column, `read`'s detail would be pushed to the long name's width. Name
    // and detail must live in ONE cell so the detail always hugs the name.
    const { container } = render(
      <ActivityStream
        streaming={false}
        activity={activity({
          status: 'done',
          steps: 2,
          entries: [
            { type: 'tool', name: 'sur9e-app_get_tracker', status: 'done' },
            { type: 'tool', name: 'read', status: 'done', detail: '/tmp/tool_output.json' },
          ],
        })}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Worked/ }));
    const steps = container.querySelectorAll('.chat-activity__step');
    expect(steps.length).toBe(2);
    const readStep = steps[1];
    expect(readStep.querySelector('.chat-activity__name')?.textContent).toBe('read');
    expect(readStep.querySelector('.chat-activity__detail')?.textContent).toContain(
      '/tmp/tool_output.json',
    );
  });

  it('renders nothing for a settled burst with no steps and no thinking text', () => {
    const { container } = render(
      <ActivityStream
        streaming={false}
        activity={activity({
          status: 'done',
          entries: [{ type: 'thinking', text: '  ' }],
        })}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('a historical interrupted burst (running status, not streaming) settles visually', () => {
    render(
      <ActivityStream
        streaming={false}
        activity={activity({
          status: 'running',
          steps: 1,
          entries: [{ type: 'tool', name: 'get_tracker', status: 'running' }],
        })}
      />,
    );
    // No live shimmer label — the summary line renders instead.
    expect(screen.getByText(/Worked · 1 step\b/)).toBeTruthy();
  });
});
