# Security Policy

## Trust model

Sur9e is a **single-user, local-first** application:

- It runs entirely on your machine; the only outbound traffic is your own AI
  provider calls (via the CLI you chose), public job-board fetches, and
  OpenRouter pricing lookups.
- **There is no authentication.** Your machine is the trust boundary. The web
  UI on `localhost:3000` is as private as your laptop.
- **Tailscale mode widens that boundary to your tailnet.** Anyone on your
  tailnet can read your CV, profile, and tracker, and can launch jobs that
  spend your AI credits. Only enable `--tailscale` on a personal tailnet.
- No telemetry, no analytics, no phone-home of any kind.

## Handling secrets

- API keys live in `.env` (gitignored). Never commit them; use `.env.example`
  as the template.
- The test gate (`test-all.mjs`) scans tracked files for common credential
  patterns (Anthropic, OpenAI, GitHub, AWS, Google, Slack) on every commit.
- `src/lib/repo-path-policy.mjs` classifies protected personal and runtime paths;
  only its enumerated scaffolding may be tracked. Verify the complete boundary
  before making a fork public:

  ```bash
  node src/lib/check-user-data-boundary.mjs --tracked
  ```

## Automated repository checks

- The local quick gate scans every tracked path, and pull requests run the same
  policy over changed, copied, and renamed Git paths.
- Dependency Review rejects newly introduced high-severity vulnerable
  dependencies.
- CodeQL analyzes JavaScript/TypeScript on pull requests, pushes to `main`, and
  weekly.
- The tracked Dependabot configuration requests weekly npm and GitHub Actions
  update PRs. Repository alerts and security updates still require the
  maintainer to enable the corresponding GitHub settings; Dependabot PRs are
  never auto-merged.
- If the CodeRabbit App is installed, its feedback is advisory for merge gating
  and is not a security control.

## Reporting a Vulnerability

**Do NOT open a public issue for security vulnerabilities.**

Instead, please email **hello@sur9e.com** with subject `[sur9e security]` and:

1. Description of the vulnerability
2. Steps to reproduce
3. Potential impact
4. Suggested fix (if any)

You will receive a response within 72 hours. We will work with you to understand and address the issue before any public disclosure.

## Scope

Security issues in the following are in scope:

- **Scripts** (`*.mjs`) — command injection, path traversal, SSRF
- **Templates** (`content/templates/`) — XSS in generated HTML/PDF
- **Web UI / API routes** — anything that lets one tailnet peer escalate beyond the documented trust model
- **Configuration** — secrets exposure, unsafe defaults

## Out of Scope

- Issues in third-party dependencies (report upstream)
- Issues requiring physical access to the user's machine
- Social engineering attacks
- sur9e is a local tool — there is no hosted service to attack

## Supported versions

Only the latest published release is supported. `main` is the development
branch; there are no maintained release branches.

## Disclosure Policy

We follow coordinated disclosure. Once a fix is released, we will credit the reporter (unless they prefer anonymity) in the release notes.
