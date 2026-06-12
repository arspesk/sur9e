// batch/lib/slug.mjs
//
// .mjs copy of companySlug from src/lib/server/format.ts (server-only,
// unimportable here). MUST stay byte-identical in behavior: the report
// Attachments section finds generated PDFs by globbing on this slug.
// Rule: lowercase → NFD normalize → strip combining marks → runs of
// non-alphanumerics become single dashes → trim leading/trailing dashes.

export function companySlug(s) {
  if (s == null) return "";
  return String(s)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// Candidate name → filename stem ("John Doe" → "john-doe"). Same rule.
export const kebabName = companySlug;
