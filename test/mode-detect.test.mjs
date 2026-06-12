import { describe, expect, it } from 'vitest';
import { canonicalMode, detectModeFromText, KNOWN_MODES } from '../cli/lib/mode-detect.mjs';

describe('canonicalMode', () => {
  it('aliases orchestration modes to the spending bucket', () => {
    expect(canonicalMode('evaluate-offer')).toBe('evaluate');
    expect(canonicalMode('scan')).toBe('screen');
    expect(canonicalMode('batch')).toBe('screen');
    expect(canonicalMode('process-queue')).toBe('screen');
  });

  it('keeps the pre-rename names as legacy aliases (same buckets)', () => {
    expect(canonicalMode('auto-pipeline')).toBe('evaluate');
    expect(canonicalMode('pipeline')).toBe('screen');
  });

  it('passes through a plain tracked mode', () => {
    expect(canonicalMode('evaluate')).toBe('evaluate');
    expect(canonicalMode('research')).toBe('research');
  });

  it('drops untracked / empty modes', () => {
    expect(canonicalMode('discovery')).toBeNull();
    expect(canonicalMode(null)).toBeNull();
    expect(canonicalMode('')).toBeNull();
  });
});

describe('detectModeFromText', () => {
  it('detects an explicit /sur9e <mode> invocation', () => {
    expect(detectModeFromText('/sur9e evaluate https://jobs.example.com/1')).toBe('evaluate');
    expect(detectModeFromText('please run /sur9e research Anthropic')).toBe('research');
  });

  it('maps interview → interview-prep', () => {
    expect(detectModeFromText('/sur9e interview Acme')).toBe('interview-prep');
  });

  it('returns discovery for a bare /sur9e', () => {
    expect(detectModeFromText('/sur9e')).toBe('discovery');
    expect(detectModeFromText('/sur9e   ')).toBe('discovery');
  });

  it('returns evaluate-offer for an unrecognized arg (pasted JD/URL)', () => {
    expect(detectModeFromText('/sur9e https://jobs.example.com/42')).toBe('evaluate-offer');
  });

  it('still recognizes the legacy auto-pipeline / pipeline names', () => {
    expect(detectModeFromText('/sur9e auto-pipeline')).toBe('auto-pipeline');
    expect(detectModeFromText('/sur9e pipeline')).toBe('pipeline');
    expect(detectModeFromText('/sur9e process-queue')).toBe('process-queue');
  });

  it('returns null when the message is not a sur9e invocation', () => {
    expect(detectModeFromText('just a normal question about the code')).toBeNull();
    expect(detectModeFromText('')).toBeNull();
    expect(detectModeFromText(null)).toBeNull();
  });

  it('keeps the mode list as the single source of truth', () => {
    expect(KNOWN_MODES.has('evaluate')).toBe(true);
    expect(KNOWN_MODES.has('tailor-cv')).toBe(true);
  });
});
