import { existsSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fetchJobDescription } from "../jd-fetcher.mjs";

function savedJdPath(rootPath, rawPath) {
  if (typeof rawPath !== "string" || !rawPath) return null;
  const allowedRoot = resolve(rootPath, "inputs/jds");
  const full = resolve(rootPath, rawPath);
  const rel = relative(allowedRoot, full);
  if (rel.startsWith("..") || rel === "" || resolve(allowedRoot, rel) !== full) return null;
  return full;
}

/**
 * Resolve the job description for a legacy URL offer, an imported URL offer,
 * or a first-class pasted-text offer. Imported URL and text sources are read
 * only from the contained inputs/jds directory; legacy URLs are fetched live.
 */
export async function resolveOfferSource(
  rootPath,
  offer,
  { fetcher = fetchJobDescription } = {},
) {
  if (offer?.sourceKind === "text" || offer?.sourceKind === "url") {
    const full = savedJdPath(rootPath, offer.jdPath);
    if (!full) throw new Error("invalid saved JD path");
    if (!existsSync(full)) throw new Error(`saved JD not found: ${offer.jdPath}`);
    return {
      kind: offer.sourceKind,
      label:
        offer.sourceKind === "url" && offer.url
          ? offer.url
          : "Saved pasted job description",
      jd: { status: "ok", text: readFileSync(full, "utf-8") },
    };
  }
  if (typeof offer?.url === "string" && offer.url) {
    return {
      kind: "url",
      label: offer.url,
      jd: await fetcher(offer.url),
    };
  }
  throw new Error("offer has neither a URL nor a saved pasted job description");
}
