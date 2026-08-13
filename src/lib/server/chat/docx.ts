import 'server-only';

// Extract plain text from a .docx (OOXML) buffer so Word documents dropped
// into chat actually reach the agent as readable text — the provider's
// file-reading tool can't parse the binary zip (issue #73). mammoth is loaded
// lazily so it only enters the server bundle when a docx is really uploaded.
export async function extractDocxText(buffer: Buffer): Promise<string> {
  const mammoth = (await import('mammoth')).default;
  const { value } = await mammoth.extractRawText({ buffer });
  return value.trim();
}
