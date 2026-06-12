# Customization Guide

## Profile (inputs/personalization/profile.yml)

This is the single source of truth for your identity. All modes read from here.

Key sections:

- **candidate**: Name, email, phone, location, LinkedIn, portfolio
- **target_roles**: Your North Star roles and archetypes
- **narrative**: Your headline, exit story, superpowers, proof points
- **compensation**: Target range, minimum, currency
- **location**: Country, timezone, visa status, on-site availability

## Target Roles (inputs/personalization/narrative.md)

The archetype table in `narrative.md` determines how offers are scored and CVs are framed. Edit the table to match YOUR career targets:

```markdown
| Archetype       | Thematic axes | What they buy  |
| --------------- | ------------- | -------------- |
| **Your Role 1** | key skills    | what they need |
| **Your Role 2** | key skills    | what they need |
```

Also update the "Adaptive Framing" table to map YOUR specific projects to each archetype.

## Search keywords (inputs/personalization/profile.yml)

Edit the `search` section of `profile.yml` to customize what the scanners look for:

- **search.terms**: Keywords passed to JobSpy queries (one query per term). The same list is the title sieve for **both** scanners — a returned title must contain at least one term to survive.
- **search.locations**: Locations to crawl (JobSpy only).

`search.terms` is the single filter source for both the ATS portal scan and JobSpy — there are no separate portal-side filters.

## ATS portals (inputs/personalization/portals.yml)

The ATS portal scanner reads `tracked_companies` from `portals.yml` and fetches each company's career feed directly (Greenhouse, Ashby, Lever, Workday, Workable, Recruitee, SmartRecruiters, SolidJobs) — zero AI tokens.

1. Copy the template: `cp content/examples/personalization/portals.yml inputs/personalization/portals.yml`
2. Add companies under `tracked_companies`:
   - **Greenhouse** → set both `careers_url` and `api` (the `boards-api` JSON endpoint).
   - **Ashby / Lever / Workable / Workday / Recruitee / SmartRecruiters** → just `careers_url`; the scanner derives the API endpoint.
   - **SolidJobs** → set `careers_url` to the public-api endpoint directly (`https://solid.jobs/public-api/offers/<division>`).
   - For any other careers page, use a [custom parser](#custom-parsers-any-careers-page) (below).
   - `enabled: false` (or omit) to skip a company without deleting it.
3. Toggle the **ATS portals** source on/off in **Settings → Job scanning → Sources**. The panel there shows how many companies are ready to scan, by provider.

If `portals.yml` is absent (or the ATS source is off), the scan simply runs JobSpy — no error.

### Custom parsers (any careers page)

For a company whose careers page is **none** of the built-in ATS, point its `portals.yml` entry at a local script that fetches the postings and prints them as JSON. The scanner runs the script and pipes its output through the same title sieve, location filter, and dedup as the built-in providers.

1. Copy the template into the parsers folder:
   `cp content/examples/parsers/example.mjs inputs/parsers/acme.mjs`
   (Scripts **must** live in `inputs/parsers/` — the scanner refuses to run anything outside it. The folder ships with a README; your scripts there are gitignored.)
2. Fill in the script's `fetchJobs()` to return `[{ title, url, location? }]`. The fastest path is usually the careers page's hidden JSON endpoint (open the Network tab and find the XHR that returns the job list). Or just ask your agent: **"write a sur9e parser for Acme's careers page"** — it can inspect the page and write it for you.
3. Reference it in `portals.yml`:
   ```yaml
   - name: Acme
     careers_url: https://acme.example.com/careers
     parser:
       command: node # allowlisted: python3/python/node/deno/bash/sh/ruby
       script: inputs/parsers/acme.mjs
       args: ["--url", "{careers_url}"] # {careers_url}/{company} are substituted
     enabled: true
   ```

The company shows a read-only **Custom parser** badge in **Settings → ATS portals**; edit the script in your editor, not the form (the form preserves the `parser:` block as-is). Guardrails: the `command` must be an allowlisted interpreter, the `script` must resolve inside `inputs/parsers/`, and each run is sandboxed with no shell, a 20s timeout, and a 2 MB output cap.

### Work-mode + auto-broadening

Two `location.*` fields in `profile.yml` shape JobSpy's queries:

- **`location.onsite_availability`** (`remote` / `hybrid` / `onsite` / `open`):
  - `remote` — every query fires with `is_remote=true`. Only remote-tagged jobs surface.
  - Anything else — `is_remote=false`. JobSpy returns all work modes inside the listed `search.locations`.
- **`location.location_flexibility`** (`strict` / `flexible` / `open`):
  - `strict` / `flexible` — JobSpy queries only the locations listed in `search.locations`.
  - `open` — JobSpy adds **one extra query** for `location.country` with `is_remote=true`. Broadens to remote-anywhere-in-country without pulling onsite-elsewhere noise (i.e. you won't be flooded with Boston-onsite roles when you live in LA).

Example: `onsite_availability=open`, `location_flexibility=open`, `country=United States`, `search.locations=["Los Angeles"]` produces:

- `"Los Angeles"` query with `is_remote=false` → LA-area in any mode (remote + hybrid + onsite)
- `"United States"` query with `is_remote=true` → remote-anywhere-in-US

Auto-added country query is suppressed when `onsite_availability=remote` (would be redundant — every query is already remote-only).

## AI Providers & Fallback Models (inputs/config/config.yml)

Two equivalent paths configure which model runs each mode: **Settings → AI
providers & models** in the web app, or hand-editing the `providers` block in
`inputs/config/config.yml`. Hand edits are first-class — the same loader reads
both, and the Settings save round-trips any keys you add by hand.

A `fallback` pair lets a run retry once on a different model when it fails for
a model-related reason:

```yaml
providers:
  default_provider: claude
  default_model: claude-opus-4-7
  # Retried once when a run fails for a model-related reason
  # (model unavailable, overloaded, rate-limited, quota, CLI missing).
  # Remove the key to turn fallback off.
  fallback: { platform: codex, model: gpt-5-codex }
  modes:
    evaluate:
      platform: claude
      model: claude-opus-4-7
      # Per-mode fallback wins over the global one. A row may carry ONLY
      # a fallback — its primary then inherits the global default.
      fallback: { platform: claude, model: claude-sonnet-4-6 }
```

The fallback does **not** trigger on: auth errors (re-login with the
provider's CLI), context overflow, timeouts, or unrecognized errors — those
surface as-is rather than retrying on a model that would fail the same way.

## CV Template (content/templates/cv-template.html)

The HTML template uses these design tokens:

- **Fonts**: Space Grotesk (headings) + DM Sans (body) — self-hosted in `public/fonts/`
- **Colors**: Cyan primary (`hsl(187,74%,32%)`) + Purple accent (`hsl(270,70%,45%)`)
- **Layout**: Single-column, ATS-optimized

To customize fonts/colors, edit the CSS in the template. Update font files in `public/fonts/` if switching fonts.

## Negotiation Scripts (inputs/personalization/narrative.md)

Your negotiation scripts live in `inputs/personalization/narrative.md` (user layer — never auto-updated). Replace the example scripts with your own:

- Target ranges
- Geographic arbitrage strategy
- Pushback responses

Do NOT edit `content/modes/_shared.md` for personal scripts — that file is in the system layer and gets overwritten on update. See [data-contract.md](data-contract.md) for the layer split.

## Hooks (Optional)

sur9e can integrate with external systems via Claude Code hooks. Example hooks:

```json
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "echo 'sur9e session started'"
          }
        ]
      }
    ]
  }
}
```

Save hooks in `.claude/settings.json`.

## States (content/templates/states.yml)

The canonical states rarely need changing. If you add new states, update:

1. `content/templates/states.yml`
2. `normalize-statuses.mjs` (alias mappings)
3. `content/modes/_shared.md` (any references)
