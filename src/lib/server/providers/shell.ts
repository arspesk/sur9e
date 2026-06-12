// src/lib/server/providers/shell.ts
//
// POSIX single-quote escaping shared by every provider adapter: wrap in
// single quotes, with embedded single quotes closed/escaped/reopened
// ('\'' sequence). One implementation so a quoting fix never has to be
// applied four times.

import 'server-only';

export function escapeForBash(s: string): string {
  return `'${s.replace(/'/g, `'"'"'`)}'`;
}
