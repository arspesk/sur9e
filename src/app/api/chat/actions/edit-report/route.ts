export const runtime = 'nodejs';

import { readFileSync } from 'node:fs';
import { jsonError } from '@/lib/http-errors';
import { ROOT } from '@/lib/root';
import { EditReportActionRequest } from '@/lib/schemas/chat-actions';
import { createConfirm, describeEditReport } from '@/lib/server/chat/confirms';
import {
  applyReportBodyEdit,
  parseFrontmatter,
  reportPathForNum,
  saveReport,
} from '@/lib/server/reports';
import { revalidatePath } from '@/server/revalidate';

export async function POST(request: Request) {
  const raw = await request.json().catch(() => null);
  const parsed = EditReportActionRequest.safeParse(raw);
  if (!parsed.success) {
    return jsonError(parsed.error.issues[0]?.message ?? 'invalid body', 400);
  }
  const { num, oldText, newText, summary, terminalApproved } = parsed.data;

  // Resolve + read the report up front so a doomed confirm card is never shown:
  // no report file, or a missing/ambiguous old_text, all fail fast here before
  // any card is parked.
  const filePath = reportPathForNum(ROOT, num);
  if (!filePath) return jsonError(`no report for offer #${num}`, 400);
  let current: string;
  try {
    current = readFileSync(filePath, 'utf-8');
  } catch {
    return jsonError(`no report for offer #${num}`, 400);
  }

  // Validate the unique match now (the resolver re-validates against the live
  // file at approval time — this is the fail-fast that keeps a broken edit off
  // the confirm card).
  const preview = applyReportBodyEdit(current, oldText, newText);
  if ('error' in preview) {
    const message =
      preview.error === 'text to replace not found'
        ? `text to replace not found in report #${num}`
        : preview.error;
    return jsonError(message, 400);
  }

  const turnId = request.headers.get('x-sur9e-turn');
  const { summary: cardSummary, meta } = describeEditReport(num, oldText, newText, summary);

  // Web chat context: EVERY write requires the confirm card — terminalApproved
  // is deliberately ignored here. The actual write + revalidate happen in
  // resolveConfirm / the confirms resolve route on approval.
  if (turnId) {
    const { token } = createConfirm(ROOT, {
      turnId,
      kind: 'edit-report',
      payload: { num, filePath, oldText, newText },
      summary: cardSummary,
      meta,
    });
    return Response.json({ needsConfirm: true, token, summary: cardSummary, meta });
  }

  // Terminal context (no turn id): the human is at the keyboard. The agent must
  // ask them directly, then re-call with terminalApproved.
  if (terminalApproved !== true) {
    return Response.json({ needsConfirm: true, summary: cardSummary, meta });
  }

  try {
    const { frontmatter, body } = parseFrontmatter(preview.markdown);
    saveReport({ filePath, frontmatter, body });
    revalidatePath('/report/[filename]', 'page');
    revalidatePath('/offers');
    return Response.json({ edited: true, report: { num } });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'failed to edit report', 400);
  }
}
