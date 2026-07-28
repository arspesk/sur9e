// lib/schemas/chat-actions.ts
//
// Request schemas for the chat action routes (/api/chat/actions/*) and
// the confirm resolution route (/api/chat/confirms/[token]). These are
// the zod boundary between the sur9e-app MCP server / web confirm cards
// and the server library.

import { z } from 'zod';
import { ApplicationStatus } from './applications';
import { JobType } from './jobs';

export const TextOfferStartKind = z.enum([
  'screen',
  'screen-evaluate',
  'evaluate',
  'tailor-cv',
  'cover-letter',
  'research',
  'interview-prep',
  'reach-out',
  'negotiate',
]);
export type TextOfferStartKind = z.infer<typeof TextOfferStartKind>;

export const StartJobActionRequest = z.object({
  kind: JobType,
  params: z.record(z.string(), z.unknown()).optional(),
  /** Terminal sessions only; ignored whenever an X-Sur9e-Turn header is present. */
  terminalApproved: z.boolean().optional(),
});
export type StartJobActionRequest = z.infer<typeof StartJobActionRequest>;

export const CancelJobActionRequest = z.object({
  jobId: z.string().regex(/^[a-z0-9-]{1,64}$/),
  terminalApproved: z.boolean().optional(),
});
export type CancelJobActionRequest = z.infer<typeof CancelJobActionRequest>;

export const CreateOfferFromTextActionRequest = z.object({
  text: z.string().trim().min(1).max(32_000),
  company: z.string().trim().min(1).max(160).optional(),
  role: z.string().trim().min(1).max(240).optional(),
  startKind: TextOfferStartKind.optional(),
  terminalApproved: z.boolean().optional(),
});
export type CreateOfferFromTextActionRequest = z.infer<typeof CreateOfferFromTextActionRequest>;

export const SetStatusActionRequest = z.object({
  num: z.number().int().positive(),
  status: ApplicationStatus,
  terminalApproved: z.boolean().optional(),
});
export type SetStatusActionRequest = z.infer<typeof SetStatusActionRequest>;

// Surgical find/replace edit of a generated report's body. camelCase over the
// wire (oldText/newText); the sur9e-app MCP tool maps old_text→oldText. newText
// may be '' (a pure deletion); oldText must be non-empty so the match is
// meaningful.
export const EditReportActionRequest = z.object({
  num: z.number().int().positive(),
  oldText: z.string().min(1),
  newText: z.string(),
  summary: z.string().optional(),
  terminalApproved: z.boolean().optional(),
});
export type EditReportActionRequest = z.infer<typeof EditReportActionRequest>;

// App-internal routes only (e.g. /table, /report/1023) — never external URLs.
export const NavigateActionRequest = z.object({
  path: z.string().regex(/^\/[A-Za-z0-9\-_/]*$/, 'path must be an app-internal route like /table'),
});
export type NavigateActionRequest = z.infer<typeof NavigateActionRequest>;

export const ConfirmResolveRequest = z.object({
  approve: z.boolean(),
});
export type ConfirmResolveRequest = z.infer<typeof ConfirmResolveRequest>;
