// src/lib/server/parse-error.ts
//
// Human-readable descriptions of YAML / zod parse failures for the
// fail-soft user-file loaders (profile.yml, config.yml). Keeps the
// surfaced message short enough for a banner: js-yaml errors drop their
// multi-line code-frame snippet and carry a 1-based line number when the
// parser knows it; zod errors collapse to `path: message` pairs instead
// of the raw JSON issue dump.

import 'server-only';
import yaml from 'js-yaml';
import { ZodError } from 'zod';

export interface ParseErrorInfo {
  /** Short, single-paragraph cause suitable for UI copy. */
  message: string;
  /** 1-based line number of the YAML syntax error, when available. */
  line: number | null;
}

export function describeParseError(err: unknown): ParseErrorInfo {
  if (err instanceof yaml.YAMLException) {
    const line = typeof err.mark?.line === 'number' ? err.mark.line + 1 : null;
    // YAMLException.message embeds a multi-line code-frame snippet after
    // the first line — keep only the human-readable reason.
    const message = err.message.split('\n')[0].trim();
    return { message, line };
  }
  if (err instanceof ZodError) {
    const message = err.issues
      .map(i => `${i.path.map(String).join('.') || '(root)'}: ${i.message}`)
      .join('; ');
    return { message, line: null };
  }
  return { message: err instanceof Error ? err.message : String(err), line: null };
}
