#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";
import { buildScreeningPolicy } from "./screening-policy.mjs";
import { resolveRuntimeForMode, runModeLLM } from "./lib/llm.mjs";
import { findOfferRow } from "./lib/offers.mjs";
import { resolveOfferSource } from "./lib/offer-source.mjs";
import { stripFrontMatter } from "./lib/report-file.mjs";
import { trackModeUsage } from "./lib/usage.mjs";
import { buildScreenReport, buildUserMessage, parseScreenResponse } from "./screen.mjs";

function readOptional(path, fallback = "") {
  return existsSync(path) ? readFileSync(path, "utf-8") : fallback;
}

export async function runTextScreen(
  ctx,
  {
    resolveRuntime = resolveRuntimeForMode,
    runLLM = runModeLLM,
    trackUsage = trackModeUsage,
  } = {},
) {
  const offer = findOfferRow(ctx.rootPath, ctx.num);
  if (!offer) throw new Error(`offer #${ctx.num} not found in data/applications.md`);
  if (offer.sourceKind !== "text") {
    throw new Error(`offer #${ctx.num} is not backed by a pasted job description`);
  }
  const source = await resolveOfferSource(ctx.rootPath, offer);
  const cv = readFileSync(`${ctx.rootPath}/inputs/personalization/cv.md`, "utf-8");
  const profile = readOptional(
    `${ctx.rootPath}/inputs/personalization/profile.yml`,
    "# (profile.yml missing — score axes with neutral assumptions)",
  );
  const settings = yaml.load(readOptional(`${ctx.rootPath}/inputs/config/config.yml`, "{}")) || {};
  const profileData = yaml.load(profile) || {};
  const policy = buildScreeningPolicy(settings, profileData);
  const modeBody = stripFrontMatter(
    readFileSync(`${ctx.rootPath}/content/modes/screen.md`, "utf-8"),
  );
  const prompt = `${modeBody}\n\n---\n\n${buildUserMessage(
    {
      company: offer.company,
      title: offer.role,
      sourceLabel: source.label,
    },
    source.jd,
    cv,
    profile,
    policy.scoreThreshold,
  )}`;
  const runtime = resolveRuntime(ctx.rootPath, "screen");
  const result = await runLLM(ctx.rootPath, "screen", prompt, {
    timeoutMs: 180000,
    logsDir: `${ctx.rootPath}/batch/logs/screen`,
    runtime,
    tee: true,
  });
  if (!result.ok) throw new Error(result.error || "screening provider failed");
  const parsed = parseScreenResponse(`${result.stdout}\n${result.stderr || ""}`);
  const date = new Date().toISOString().slice(0, 10);
  const slug = String(offer.company || "unknown")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "unknown";
  const fields = {
    ...parsed,
    num: ctx.num,
    slug,
    date,
    company: offer.company === "Unknown" ? parsed.company : offer.company,
    role: offer.role === "Unknown role" ? parsed.role : offer.role,
    source_kind: "text",
    jd_path: offer.jdPath,
    jd_hash: offer.jdHash,
  };
  // A tracked pasted-text offer already owns a canonical report path.
  // Pass it through the trusted function option rather than the model-derived
  // fields bag so URL screening cannot redirect tracker links by hallucinating
  // a report_path key.
  const built = buildScreenReport(fields, policy.scoreThreshold, {
    reportPath: offer.reportPath,
    textSource: { jdPath: offer.jdPath, jdHash: offer.jdHash },
  });
  mkdirSync(`${ctx.rootPath}/artifacts/reports`, { recursive: true });
  mkdirSync(`${ctx.rootPath}/batch/tracker-additions`, { recursive: true });
  writeFileSync(`${ctx.rootPath}/${offer.reportPath}`, built.report, "utf-8");
  writeFileSync(
    `${ctx.rootPath}/batch/tracker-additions/${String(ctx.num).padStart(3, "0")}-${slug}.tsv`,
    `${built.tsv}\n`,
    "utf-8",
  );
  try {
    trackUsage(runtime, "screen", result.promptText || prompt, result.stdout, {
      rootPath: ctx.rootPath,
    });
  } catch {
    // Usage bookkeeping must never discard a successful screen result.
  }
  return { summary: `screened pasted-text offer #${ctx.num}`, status: built.status };
}

async function main() {
  const args = process.argv.slice(2);
  const idx = args.indexOf("--num");
  const num = idx === -1 ? NaN : Number(args[idx + 1]);
  if (!Number.isInteger(num) || num < 1) throw new Error("--num <offer number> is required");
  const rootPath = resolve(process.cwd());
  const result = await runTextScreen({ rootPath, num });
  console.log(`✅ ${result.summary}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(`FATAL: ${error.message}`);
    process.exit(1);
  });
}
