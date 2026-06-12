export function jsonError(message: string, status = 500) {
  return Response.json({ error: message }, { status });
}

export function parsePositiveInt(value: string | undefined): number | null {
  if (!value) return null;
  // Only accept a clean positive integer; Number.parseInt would silently
  // coerce "447abc" -> 447 and "3.5" -> 3, accepting malformed path segments.
  if (!/^\d+$/.test(value.trim())) return null;
  const num = Number.parseInt(value, 10);
  return Number.isInteger(num) && num > 0 ? num : null;
}
