// src/lib/server/report-markdown/types.ts
//
// Shared types for the report-markdown normalizer. A Fix is an applied
// auto-correction (logged); an Issue is a validation finding (no mutation).

export interface Fix {
  rule: string;
  before: string;
  after: string;
  line?: number;
}

export interface Issue {
  rule: string;
  severity: 'error' | 'warn';
  message: string;
  line?: number;
}

export interface NormalizeResult {
  markdown: string;
  fixes: Fix[];
}

/** An auto-fix transform: returns possibly-changed text + any fixes it applied. */
export type AutoFix = (md: string) => { md: string; fixes: Fix[] };

/** A validator: returns issues found (no mutation). */
export type Validator = (md: string) => Issue[];
