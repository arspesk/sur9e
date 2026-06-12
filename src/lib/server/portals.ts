// loadPortals returns null when inputs/personalization/portals.yml is
// missing; callers coalesce with `?? { tracked_companies: [] }`.
//
// Pure provider logic (detectProvider / summarizePortals / smart-add
// derivation) lives in src/lib/portals-detect.ts so the Settings → ATS
// portals client section can import it too; re-exported here so existing
// server-side imports keep working.

import 'server-only';
import { join } from 'node:path';
import yaml from 'js-yaml';
import { PortalsShape } from '../schemas/portals';
import { atomicWrite } from './atomic-write';
import { readFileOrNull } from './read-or-null';

const PORTALS_FILE = 'inputs/personalization/portals.yml';
const EXAMPLE_PORTALS_FILE = 'content/examples/personalization/portals.yml';

export type { AtsProvider, AtsSummary } from '../portals-detect';
export {
  detectProvider,
  PROVIDER_LABELS,
  PROVIDER_ORDER,
  summarizePortals,
} from '../portals-detect';
export type { PortalsShape as PortalsShapeType } from '../schemas/portals';
export { PortalsShape };

export function loadPortals(rootPath: string): PortalsShape | null {
  const filePath = join(rootPath, PORTALS_FILE);
  const content = readFileOrNull(filePath);
  if (content == null) return null;
  const raw = yaml.load(content);
  if (raw == null) return null;
  return PortalsShape.parse(raw);
}

export function savePortals(rootPath: string, data: unknown): void {
  const parsed = PortalsShape.parse(data);
  const filePath = join(rootPath, PORTALS_FILE);
  const yamlStr = yaml.dump(parsed, { lineWidth: 100, noRefs: true });
  atomicWrite(filePath, yamlStr);
}

/**
 * Copy the example tracked-companies list into the user's portals.yml.
 * Refuses when tracked_companies is already non-empty — the import is a
 * bootstrap convenience, never an overwrite.
 */
export function importExamplePortals(rootPath: string): PortalsShape {
  const existing = loadPortals(rootPath);
  if (existing && existing.tracked_companies.length > 0) {
    throw new Error('portals.yml already has tracked companies — refusing to overwrite them');
  }
  const content = readFileOrNull(join(rootPath, EXAMPLE_PORTALS_FILE));
  if (content == null) {
    throw new Error(`example portals file not found: ${EXAMPLE_PORTALS_FILE}`);
  }
  const parsed = PortalsShape.parse(yaml.load(content));
  savePortals(rootPath, parsed);
  return parsed;
}
