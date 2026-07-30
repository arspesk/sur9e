import catalogData from './catalog.json';

export type ModeExecution = 'background' | 'inline' | 'handoff' | 'composite';
export type ModeScope = 'offer' | 'system' | 'conversation';

export interface ModeDefinition {
  id: string;
  label: string;
  description: string;
  execution: ModeExecution;
  scope: ModeScope;
  requiresEvaluation?: boolean;
  mutatesReport?: boolean;
  expandsTo?: readonly string[];
  legacyStartJob?: boolean;
  singleJob?: boolean;
}

export type ModeId = keyof typeof catalogData.modes;
export type JobModeId = Extract<
  ModeId,
  | 'batch-evaluate'
  | 'cover-letter'
  | 'evaluate'
  | 'interview-prep'
  | 'latex'
  | 'negotiate'
  | 'reach-out'
  | 'research'
  | 'scan'
  | 'screen'
  | 'screen-evaluate'
  | 'tailor-cv'
>;

/** Canonical public mode registry. The JSON data is also imported directly
 * by the zero-dependency MCP stdio server, while this typed adapter serves
 * the application, prompt, planner, and slash-command UI. */
export const MODE_CATALOG = Object.freeze(
  Object.fromEntries(
    Object.entries(catalogData.modes).map(([id, definition]) => [
      id,
      { id, ...definition } as ModeDefinition,
    ]),
  ),
) as Readonly<Record<ModeId, Readonly<ModeDefinition>>>;

export const MODE_ALIASES = Object.freeze(catalogData.aliases as Readonly<Record<string, ModeId>>);

export function resolveModeId(value: string): ModeId | null {
  const normalized = value.trim().toLowerCase();
  if (normalized in MODE_CATALOG) return normalized as ModeId;
  return MODE_ALIASES[normalized] ?? null;
}

export const CHAT_DISCOVERABLE_MODES: readonly ModeDefinition[] = Object.freeze(
  Object.values(MODE_CATALOG),
);

/** Modes accepted by the backward-compatible single-job surface. */
export const JOB_MODE_IDS: readonly JobModeId[] = Object.freeze(
  Object.values(MODE_CATALOG)
    .filter(mode => mode.singleJob === true)
    .map(mode => mode.id as JobModeId),
);
