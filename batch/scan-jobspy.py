#!/usr/bin/env python3
"""
scan-jobspy.py — Scrape LinkedIn, Indeed, Glassdoor, ZipRecruiter, Google
                 Jobs via JobSpy. Write results to batch/jobspy-results.csv
                 and emit compact JSON on stdout for the Node wrapper.

Reads config from two files:

    inputs/personalization/profile.yml:
      search:
        terms:         ["Solutions Engineer", "Forward Deployed", ...]
        locations:     ["United States", "San Francisco, CA"]

    inputs/config/config.yml:
      scanning:
        jobspy:
          sites:           linkedin (hardcoded — the only reliable board)
          results_wanted:  50           # per (term, site) pair
          hours_old:       72           # only offers newer than N hours

Usage:
    batch/jobspy-env/bin/python batch/scan-jobspy.py [--dry-run]
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PROFILE = ROOT / "inputs" / "personalization" / "profile.yml"
SETTINGS = ROOT / "inputs" / "config" / "config.yml"
CSV_OUT = ROOT / "batch" / "jobspy-results.csv"


def _load_yaml(path: Path) -> dict:
    if not path.exists():
        return {}
    import yaml
    with open(path, "r") as f:
        return yaml.safe_load(f) or {}


def load_config() -> dict:
    """Search parameters split between two files:
      - inputs/personalization/profile.yml — `search.{terms, locations}` for
        what to look for and where, plus `location.{country, onsite_availability,
        location_flexibility}` for work-mode + auto-broadening.
      - inputs/config/config.yml — `scanning.jobspy.{hours_old, results_wanted}`
        for technical crawler knobs.
    """
    technical = (_load_yaml(SETTINGS).get("scanning") or {}).get("jobspy") or {}
    profile = _load_yaml(PROFILE)
    profile_search = profile.get("search") or {}
    profile_location = profile.get("location") or {}

    cfg = {**technical}
    if profile_search.get("terms"):
        cfg["terms"] = profile_search["terms"]
    if profile_search.get("locations"):
        cfg["location"] = profile_search["locations"]
    # Work-mode + auto-broadening — derived from profile.location.
    cfg["onsite_availability"] = profile_location.get("onsite_availability") or "open"
    cfg["location_flexibility"] = profile_location.get("location_flexibility") or "strict"
    cfg["country"] = profile_location.get("country") or ""
    return cfg


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    cfg = load_config()
    if not cfg.get("enabled", True):
        print("jobspy.enabled=false — skipping", file=sys.stderr)
        return 0

    # LinkedIn only — other boards (indeed/glassdoor/zip_recruiter/google)
    # proved unreliable (bot detection, 403s) and were removed from the UI.
    sites = ["linkedin"]
    # location accepts either a single string or a list of strings; the crawler
    # iterates over each. Backward-compatible with the old scalar form.
    raw_location = cfg.get("location")
    if isinstance(raw_location, list):
        locations = [str(loc).strip() for loc in raw_location if str(loc).strip()]
    elif raw_location:
        locations = [str(raw_location).strip()]
    else:
        locations = ["United States"]
    raw_terms = cfg.get("terms") or cfg.get("search_terms") or ["Solutions Engineer"]
    # Wrap each term in double-quotes before handing to LinkedIn / Indeed.
    # Their search APIs treat quoted phrases as stricter matches (closer to
    # exact-phrase), which suppresses the fuzzy "related role" reranking that
    # otherwise floats e.g. "Senior Software Engineer" into a "Solutions
    # Engineer" query. Skip the wrap if the user already quoted the term.
    def _quote(term: str) -> str:
        t = str(term).strip()
        if len(t) >= 2 and t.startswith('"') and t.endswith('"'):
            return t
        return f'"{t}"'
    terms = [_quote(t) for t in raw_terms if str(t).strip()]
    results_wanted = int(cfg.get("results_wanted") or 40)
    hours_old = int(cfg.get("hours_old") or 168)

    # Work-mode + auto-broadening mapping (see docs/customization.md):
    #   onsite_availability='remote' → every query fires with is_remote=True
    #     (only remote-tagged jobs surface).
    #   onsite_availability=anything else → is_remote=False for listed locations
    #     (JobSpy returns all modes).
    #   location_flexibility='open' AND a country is set → add ONE extra query
    #     for the country with is_remote=True. Broadens to remote-anywhere-in-
    #     country without pulling onsite-elsewhere noise into the pipeline.
    onsite_availability = (cfg.get("onsite_availability") or "open").lower()
    location_flexibility = (cfg.get("location_flexibility") or "strict").lower()
    country = (cfg.get("country") or "").strip()
    primary_is_remote = onsite_availability == "remote"
    broaden_country = (
        location_flexibility == "open" and bool(country) and not primary_is_remote
    )
    # Build the (location, is_remote) plan. List-of-tuples preserves the
    # primary listing first; the country-wide broaden query appends last.
    location_plan = [(loc, primary_is_remote) for loc in locations]
    if broaden_country:
        location_plan.append((country, True))

    print(
        f"JobSpy scan: sites={sites} plan={location_plan!r} "
        f"terms={len(terms)} results_wanted={results_wanted} hours_old={hours_old}",
        file=sys.stderr,
    )

    if args.dry_run:
        print(
            json.dumps(
                {
                    "dry_run": True,
                    "sites": sites,
                    "location_plan": location_plan,
                    "onsite_availability": onsite_availability,
                    "location_flexibility": location_flexibility,
                    "terms": terms,
                    "results_wanted": results_wanted,
                }
            )
        )
        return 0

    try:
        from jobspy import scrape_jobs  # type: ignore
        import pandas as pd
    except Exception as e:
        print(
            f"ERROR: jobspy import failed — run batch/jobspy-env/bin/pip install python-jobspy. {e}",
            file=sys.stderr,
        )
        return 2

    import time

    def scrape_one(site, term, loc, is_remote):
        """Scrape one (site, term, location, is_remote) combo. Single attempt
        — retries are not useful when sites return structural errors (bot
        detection, API breakage)."""
        try:
            df = scrape_jobs(
                site_name=[site],
                search_term=term,
                location=loc,
                results_wanted=results_wanted,
                hours_old=hours_old,
                is_remote=is_remote,
            )
            return df, None
        except Exception as e:
            return None, e

    all_jobs = []
    for term in terms:
        for site in sites:
            for loc, is_remote in location_plan:
                df, err = scrape_one(site, term, loc, is_remote)
                remote_tag = " [remote]" if is_remote else ""
                tag = f"  {site} / {term!r} @ {loc!r}{remote_tag}"
                if err is not None:
                    print(f"{tag}: ERR {err}", file=sys.stderr)
                elif df is None or df.empty:
                    print(f"{tag}: 0", file=sys.stderr)
                else:
                    df = df.copy()
                    df["search_term"] = term
                    df["search_site"] = site
                    df["search_location"] = loc
                    all_jobs.append(df)
                    print(f"{tag}: {len(df)}", file=sys.stderr)
                time.sleep(1)  # Throttle between calls

    if not all_jobs:
        print("No jobs returned by any site.", file=sys.stderr)
        print("[]")
        return 0

    combined = pd.concat(all_jobs, ignore_index=True)

    # Normalize columns we care about; keep the CSV for debugging/inspection
    CSV_OUT.parent.mkdir(parents=True, exist_ok=True)
    combined.to_csv(CSV_OUT, index=False)

    # Emit a compact JSON for the Node wrapper
    def pick(row, *names):
        for n in names:
            if n in row and row[n] is not None and str(row[n]) != "nan":
                return str(row[n])
        return ""

    records = []
    for _, row in combined.iterrows():
        rec = {
            "title": pick(row, "title"),
            "company": pick(row, "company"),
            # jobspy exposes a logo URL on LinkedIn/Indeed rows; carried through
            # to report frontmatter so the avatar shows the real logo (favicon
            # fallback handles rows where it is absent).
            "company_logo": pick(row, "company_logo", "logo_photo_url"),
            "url": pick(row, "job_url", "job_url_direct"),
            "location": pick(row, "location"),
            "site": pick(row, "search_site"),
            "search_term": pick(row, "search_term"),
            "date_posted": pick(row, "date_posted"),
        }
        if rec["url"] and rec["title"]:
            records.append(rec)

    # Print JSON to stdout; Node will consume it
    print(json.dumps(records))
    print(f"✓ Wrote {CSV_OUT} ({len(records)} records)", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
