// batch/lib/usage.mjs
//
// Uniform usage tracking for mode-runner workers. Text-format output (the
// portable contract) carries no native usage object on ANY provider, so we
// estimate input/output tokens with tiktoken cl100k_base (Anthropic/OpenAI/
// Google BPE variants agree within ~20%) and persist through trackProvider
// with estimated:true. Cost resolves at read time from the OpenRouter cache;
// unmapped models surface as N/A — never a fabricated number.

import { getEncoding } from "js-tiktoken";
import { trackProvider } from "../../cli/usage-tracker.mjs";

// Encoder construction is ~10-20ms; cache it — bulk screens call
// trackModeUsage once per URL from parallel workers.
let encoder = null;
function enc() {
  encoder ??= getEncoding("cl100k_base");
  return encoder;
}

// agy 1.0.5 silently truncates the -p message at ~48K characters (measured
// 2026-06-04 via magic-token probes: 40KB tail survives, 90KB+ doesn't;
// the stored conversation payload caps at ~50KB — see antigravity-cli
// issue #224). Counting the full prompt would overstate agy input ~6x on
// our 300KB evaluate prompts, so the estimate counts only what agy
// actually sends.
const AGY_INPUT_CHAR_CAP = 48_000;

export function trackModeUsage(runtime, modeId, promptText, responseText, { rootPath } = {}) {
  let inputText = promptText || "";
  if (runtime.provider === "antigravity" && inputText.length > AGY_INPUT_CHAR_CAP) {
    inputText = inputText.slice(0, AGY_INPUT_CHAR_CAP);
  }
  const inputTokens = inputText ? enc().encode(inputText).length : 0;
  const outputTokens = responseText ? enc().encode(responseText).length : 0;
  trackProvider(runtime.provider, inputTokens, outputTokens, {
    model: runtime.model,
    mode: modeId,
    estimated: true,
    ...(rootPath ? { rootPath } : {}),
  });
}
