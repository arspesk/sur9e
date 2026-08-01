import { expect, test } from 'vitest';
import { extractAppendedSections } from '../reports';

// Helper — minimal valid report markdown with ordinary report sections only
const REPORT_ONLY_MD = `
# Offer Report

## Role Summary
Some content here.

## Compensation
Salary details.

## Posting Legitimacy
Final verdict.
`.trim();

test('extractAppendedSections — empty string returns []', () => {
  expect(extractAppendedSections('')).toEqual([]);
});

test('extractAppendedSections — report sections return []', () => {
  expect(extractAppendedSections(REPORT_ONLY_MD)).toEqual([]);
});

test('extractAppendedSections — detects Company Research section', () => {
  const md = `${REPORT_ONLY_MD}

## Company Research

Founded in 2010, Acme Corp builds rockets.
`;
  const result = extractAppendedSections(md);
  expect(result.length).toBe(1);
  expect(result[0].title).toBe('Company Research');
  expect(result[0].body.includes('Acme Corp')).toBeTruthy();
  expect(typeof result[0].rawHtml).toBe('string');
  expect(result[0].rawHtml.length > 0).toBeTruthy();
});

test('extractAppendedSections — detects Interview Process section', () => {
  const md = `${REPORT_ONLY_MD}

## Interview Process

- Phone screen
- Technical round
`;
  const result = extractAppendedSections(md);
  expect(result.length).toBe(1);
  expect(result[0].title).toBe('Interview Process');
  expect(result[0].body.includes('Phone screen')).toBeTruthy();
});

test('extractAppendedSections — detects both sections', () => {
  const md = `${REPORT_ONLY_MD}

## Company Research

Deep dive content.

## Interview Process

Three rounds.
`;
  const result = extractAppendedSections(md);
  expect(result.length).toBe(2);
  expect(result[0].title).toBe('Company Research');
  expect(result[1].title).toBe('Interview Process');
});

test('extractAppendedSections — case-sensitive: company research (lowercase) NOT detected', () => {
  const md = `${REPORT_ONLY_MD}

## company research

Lowercase title.
`;
  expect(extractAppendedSections(md)).toEqual([]);
});

test('extractAppendedSections — partial match "Company Research X" NOT detected', () => {
  const md = `${REPORT_ONLY_MD}

## Company Research X

Extra word in title.
`;
  expect(extractAppendedSections(md)).toEqual([]);
});

test('extractAppendedSections — body does not bleed into next section', () => {
  const md = `${REPORT_ONLY_MD}

## Company Research

Research paragraph.

## Interview Process

Interview paragraph.
`;
  const result = extractAppendedSections(md);
  expect(result.length).toBe(2);
  expect(result[0].body.includes('Interview paragraph')).toBeFalsy();
  expect(result[1].body.includes('Research paragraph')).toBeFalsy();
});
