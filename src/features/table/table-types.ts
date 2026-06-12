// Summary block as ported from the parsed report — same shape the legacy
// table.html/pipeline.html consume. Field names match the on-disk JSON
// schema; comp_short/loc_short/archetype_short are the SHORT_FIELD_CAPS
// truncated variants the renderer prefers, with comp_full/locations/etc.
// available for hover tooltips.
export interface ApplicationSummary {
  compRange?: string;
  comp_short?: string;
  comp_full?: string;
  loc?: string;
  loc_short?: string;
  locations?: string[];
  archetype?: string;
  archetype_short?: string;
  archetype_full?: string;
  remote?: string;
  seniority_short?: string;
  work_mode?: string;
  company_logo?: string;
  // Canonical fields read by the surfaces (sync with report/drawer).
  seniority?: string;
  location?: string;
  tldr?: string;
  url?: string;
  /** True posting date (YYYY-MM-DD) projected from report frontmatter. */
  posted?: string;
}

export interface ApplicationRow {
  num: number;
  date: string;
  /**
   * True posting date (YYYY-MM-DD), absent when the source never reported
   * one. `date` above stays the added/scan date — the sort backbone.
   */
  posted?: string;
  company: string;
  role: string;
  score: string;
  status: string;
  pdf: string;
  reportPath: string | null;
  notes: string;
  // Flattened fields the table/drawer read directly. Legacy did the same
  // flattening inside its inline <script> (`loc: (e.summary && e.summary.loc)
  // || ''` etc.) — we do it once in useApplications so consumers don't have
  // to dive into the nested summary blob.
  url?: string;
  comp?: string;
  loc?: string;
  archetype?: string;
  archetype_full?: string;
  comp_full?: string;
  locations?: string[];
  remote?: string;
  seniority?: string;
  work_mode?: string;
  company_logo?: string;
  summary?: ApplicationSummary | null;
}

export interface RawApplicationEntry extends Omit<ApplicationRow, 'comp' | 'loc' | 'archetype'> {
  summary?: ApplicationSummary | null;
}

export interface ApplicationsResponse {
  entries: ApplicationRow[];
  count: number;
}
