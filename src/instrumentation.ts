// Next.js instrumentation hook — runs once per server boot (Node runtime).
// Home of the scan scheduler (spec 2026-06-05-scheduled-scans). Guarded
// against the edge runtime and dev double-registration (via globalThis flag
// inside startScheduler).
//
// Next 16: instrumentation.ts at src/ is auto-detected without any
// experimental flag — it is a stable API. No next.config.ts change needed.
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { startScheduler } = await import('./lib/server/jobs/scheduler');
  const { ROOT } = await import('./lib/root');
  startScheduler(ROOT);
}
