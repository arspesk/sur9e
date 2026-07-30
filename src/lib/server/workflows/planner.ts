import { MODE_CATALOG, type ModeDefinition, type ModeId, resolveModeId } from '../../modes/catalog';

export type WorkflowTarget = { num: number } | { url: string; num?: number };

export interface PlannedWorkflowStep {
  id: string;
  targetIndex: number | null;
  mode: string;
  dependsOn: string[];
  params: Record<string, unknown>;
}

export interface WorkflowPlan {
  targets: WorkflowTarget[];
  requestedModes: ModeId[];
  steps: PlannedWorkflowStep[];
  maxParallel: 4;
}

export interface PlanWorkflowInput {
  targets: WorkflowTarget[];
  modes: string[];
  evaluatedOfferNums: ReadonlySet<number>;
}

const SYSTEM_MODES = new Set<ModeId>(['scan', 'batch-evaluate', 'process-queue']);

function definitionFor(mode: ModeId): ModeDefinition {
  return MODE_CATALOG[mode] as ModeDefinition;
}

function canonicalModes(values: string[]): ModeId[] {
  const seen = new Set<ModeId>();
  const modes: ModeId[] = [];
  for (const value of values) {
    const mode = resolveModeId(value);
    if (!mode) throw new Error(`unknown mode: ${value}`);
    if (!seen.has(mode)) {
      seen.add(mode);
      modes.push(mode);
    }
  }
  if (modes.length === 0) throw new Error('at least one mode is required');
  return modes;
}

function expandModes(modes: ModeId[]): ModeId[] {
  const expanded: ModeId[] = [];
  const seen = new Set<ModeId>();
  for (const mode of modes) {
    const definition = definitionFor(mode);
    const values = definition.expandsTo ?? [mode];
    for (const value of values) {
      const canonical = resolveModeId(value);
      if (!canonical) throw new Error(`unknown expanded mode: ${value}`);
      if (!seen.has(canonical)) {
        seen.add(canonical);
        expanded.push(canonical);
      }
    }
  }
  return expanded;
}

function stepId(targetIndex: number | null, index: number, mode: string): string {
  return `${targetIndex === null ? 'system' : `target-${targetIndex}`}-${index}-${mode}`;
}

function systemPlan(requestedModes: ModeId[], targets: WorkflowTarget[]): WorkflowPlan | null {
  const systemModes = requestedModes.filter(mode => SYSTEM_MODES.has(mode));
  if (systemModes.length === 0) return null;
  if (targets.length > 0 || requestedModes.length !== 1) {
    throw new Error('system modes cannot be mixed with offer targets or other modes');
  }
  const requested = systemModes[0] as ModeId;
  const mode = requested === 'process-queue' ? 'screen' : requested;
  return {
    targets: [],
    requestedModes,
    maxParallel: 4,
    steps: [
      {
        id: stepId(null, 0, mode),
        targetIndex: null,
        mode,
        dependsOn: [],
        params: requested === 'process-queue' ? { queue: true } : {},
      },
    ],
  };
}

function validateExecutableModes(modes: ModeId[]): void {
  for (const mode of modes) {
    const definition = definitionFor(mode);
    if (definition.execution === 'inline') throw new Error(`${mode} runs inline in chat`);
    if (definition.execution === 'handoff') throw new Error(`${mode} requires a handoff`);
  }
}

function planTarget(
  target: WorkflowTarget,
  targetIndex: number,
  requestedModes: ModeId[],
  evaluatedOfferNums: ReadonlySet<number>,
): PlannedWorkflowStep[] {
  const expanded = expandModes(requestedModes);
  const isUrl = 'url' in target;
  if (isUrl && !expanded.includes('screen')) expanded.unshift('screen');

  const needsEvaluation =
    expanded.includes('evaluate') ||
    expanded.some(mode => definitionFor(mode).requiresEvaluation === true);
  const alreadyEvaluated =
    'num' in target && typeof target.num === 'number' && evaluatedOfferNums.has(target.num);
  if (needsEvaluation && !alreadyEvaluated && !expanded.includes('evaluate')) {
    const screenIndex = expanded.indexOf('screen');
    expanded.splice(screenIndex >= 0 ? screenIndex + 1 : 0, 0, 'evaluate');
  }

  const ordered: ModeId[] = [];
  if (expanded.includes('screen')) ordered.push('screen');
  if (expanded.includes('evaluate')) ordered.push('evaluate');
  ordered.push(
    ...expanded.filter(
      mode =>
        mode !== 'screen' && mode !== 'evaluate' && definitionFor(mode).mutatesReport === true,
    ),
  );
  ordered.push(
    ...expanded.filter(
      mode =>
        mode !== 'screen' && mode !== 'evaluate' && definitionFor(mode).mutatesReport !== true,
    ),
  );

  const steps: PlannedWorkflowStep[] = [];
  let lastReportStepId: string | null = null;
  let screenStepId: string | null = null;

  for (const mode of ordered) {
    const id = stepId(targetIndex, steps.length, mode);
    let dependsOn: string[] = [];
    if (mode === 'evaluate' && screenStepId) dependsOn = [screenStepId];
    else if (definitionFor(mode).mutatesReport && lastReportStepId) {
      dependsOn = [lastReportStepId];
    } else if (definitionFor(mode).requiresEvaluation && lastReportStepId) {
      dependsOn = [lastReportStepId];
    }

    const params: Record<string, unknown> =
      mode === 'screen' && isUrl ? { url: target.url } : 'num' in target ? { num: target.num } : {};
    steps.push({ id, targetIndex, mode, dependsOn, params });

    if (mode === 'screen') screenStepId = id;
    if (mode === 'evaluate' || definitionFor(mode).mutatesReport) lastReportStepId = id;
  }

  return steps;
}

export function planWorkflow(input: PlanWorkflowInput): WorkflowPlan {
  const requestedModes = canonicalModes(input.modes);
  validateExecutableModes(requestedModes);
  const system = systemPlan(requestedModes, input.targets);
  if (system) return system;
  if (input.targets.length === 0) throw new Error('offer workflows require at least one target');

  return {
    targets: input.targets,
    requestedModes,
    maxParallel: 4,
    steps: input.targets.flatMap((target, index) =>
      planTarget(target, index, requestedModes, input.evaluatedOfferNums),
    ),
  };
}
