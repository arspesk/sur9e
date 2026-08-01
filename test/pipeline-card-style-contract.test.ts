import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const pipelineCss = readFileSync(join(root, 'src/app/styles/pipeline-inline.css'), 'utf8');
const boardCard = readFileSync(join(root, 'src/features/pipeline/board-card.tsx'), 'utf8');

function declarationsFor(source: string, selector: string): Map<string, string> {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const matches = [
    ...source.matchAll(new RegExp(`(?:^|\\n)\\s*${escapedSelector}\\s*\\{([^}]*)\\}`, 'g')),
  ];

  expect(matches, `Expected exactly one CSS rule for ${selector}`).toHaveLength(1);

  const blockWithoutComments = matches[0][1].replace(/\/\*[\s\S]*?\*\//g, '');
  return new Map(
    [...blockWithoutComments.matchAll(/(?:^|;)\s*([\w-]+)\s*:\s*([^;]+?)\s*(?=;|$)/g)].map(
      match => [match[1], match[2].trim()],
    ),
  );
}

function cardIdLineSubtree(source: string): { markup: string; end: number } {
  const opening = '<div className="card-id-line">';
  const start = source.indexOf(opening);
  expect(start, 'Expected .card-id-line JSX').toBeGreaterThan(-1);

  const end = source.indexOf('</div>', start) + '</div>'.length;
  expect(end, 'Expected .card-id-line closing tag').toBeGreaterThan(start + opening.length);
  return { markup: source.slice(start, end), end };
}

describe('pipeline card style contract', () => {
  it('keeps the score beside a shrinkable company name and clear of the overflow menu', () => {
    const cardIdLine = declarationsFor(pipelineCss, '.card-id-line');
    const cardCompany = declarationsFor(pipelineCss, '.card-company');
    const scoreNum = declarationsFor(pipelineCss, '.card .score-num');

    expect(cardIdLine.get('justify-content')).toBe('flex-start');
    expect(cardIdLine.get('align-items')).toBe('baseline');
    expect(cardIdLine.get('gap')).toBe('8px');
    expect(cardIdLine.get('padding-inline-end')).toBe('44px');
    expect(cardIdLine.has('padding-right')).toBe(false);
    expect(cardCompany.get('flex')).toBe('0 1 auto');
    expect(cardCompany.get('min-width')).toBe('0');
    expect(scoreNum.get('flex')).toBe('0 0 auto');
  });

  it('keeps company and score as ordered siblings inside the identity-line subtree', () => {
    const { markup, end } = cardIdLineSubtree(boardCard);
    const childClasses = [...markup.matchAll(/<span className=(?:"([^"]+)"|\{`([^`]+)`\})/g)].map(
      match => match[1] ?? match[2],
    );
    const kebabIndex = boardCard.indexOf('className="board-card-kebab"', end);

    expect(childClasses).toEqual(['card-company', 'score-num ${scoreLevel(score)}']);
    expect(markup).not.toContain('board-card-kebab');
    expect(kebabIndex).toBeGreaterThan(end);
  });
});
