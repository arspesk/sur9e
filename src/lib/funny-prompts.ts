// lib/funny-prompts.ts
//
// Rotating "AI is …" prompts shown while a generator mode runs. Shared by
// the in-editor runningMode card (running-mode-view.tsx) and the
// loading-modal deck (loading-modal.tsx). Keys are generator-mode ids.

export const FUNNY_PROMPTS: Record<string, string[]> = {
  evaluate: [
    'Reading the JD with one eyebrow raised…',
    'Cross-checking your CV against the role…',
    'Counting how many buzzwords survived…',
    'Asking: would I hire this person?',
    'Sharpening the scoring rubric…',
  ],
  'tailor-cv': [
    'Reordering your bullets like a librarian…',
    'Bolding the buzzwords that matter…',
    'Negotiating verbs with your past self…',
    "Picking metrics that don't lie…",
    'Tightening line lengths…',
  ],
  'cover-letter': [
    "Drafting a hook that isn't cringe…",
    'Spelling the company name correctly…',
    'Closing with confidence, not desperation…',
    'Hiding the parts where you said "passionate"…',
    'Asking: would a human read past line 1?',
  ],
  research: [
    "Skimming their blog posts so you don't have to…",
    'Hunting down funding history…',
    "Counting how many product launches they've teased…",
    'Cross-referencing Glassdoor whispers…',
    'Building a 30-second elevator brief…',
  ],
  'reach-out': [
    'Finding the right person to nudge…',
    'Drafting a LinkedIn note under 200 chars…',
    'Avoiding the words "synergy" and "circle back"…',
    'Polishing your opener…',
  ],
  'interview-prep': [
    'Pulling STAR stories from your last 3 roles…',
    "Predicting the panel's favorite gotcha…",
    'Drafting your "what questions do you have?" answers…',
    'Stress-testing your weakness story…',
  ],
  negotiate: [
    'Looking up comp benchmarks for this role…',
    'Drafting the counter without flinching…',
    'Calculating equity over 4 years…',
    'Preparing the silent pause after the number…',
  ],
};

export const DEFAULT_PROMPTS = [
  'Thinking…',
  'Crunching tokens…',
  'Drafting…',
  'Polishing…',
  'Reviewing…',
];

export function promptsForMode(modeOrKind: string): string[] {
  return FUNNY_PROMPTS[modeOrKind] ?? DEFAULT_PROMPTS;
}
