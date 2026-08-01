import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const pipelineCss = readFileSync(join(root, 'src/app/styles/pipeline-inline.css'), 'utf8');
const boardCard = readFileSync(join(root, 'src/features/pipeline/board-card.tsx'), 'utf8');

function ruleBlocks(source: string, selector: string): string {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const matches = [
    ...source.matchAll(new RegExp(`(?:^|\\n)\\s*${escapedSelector}\\s*\\{([^}]*)\\}`, 'g')),
  ];

  expect(matches.length, `Expected a CSS rule for ${selector}`).toBeGreaterThan(0);
  return matches.map(match => match[1]).join('\n');
}

describe('pipeline card style contract', () => {
  it('keeps the score beside a shrinkable company name and clear of the overflow menu', () => {
    const cardIdLine = ruleBlocks(pipelineCss, '.card-id-line');
    const cardCompany = ruleBlocks(pipelineCss, '.card-company');
    const scoreNum = ruleBlocks(pipelineCss, '.card .score-num');

    expect(cardIdLine).toContain('justify-content: flex-start');
    expect(cardIdLine).not.toContain('justify-content: space-between');
    expect(cardIdLine).toContain('align-items: baseline');
    expect(cardIdLine).toContain('gap: 8px');
    expect(cardIdLine).toContain('padding-right: 30px');
    expect(cardCompany).toContain('flex: 0 1 auto');
    expect(cardCompany).toContain('min-width: 0');
    expect(scoreNum).toContain('flex: 0 0 auto');
  });

  it('renders company, score, then the card actions menu in that order', () => {
    const cardMarkup = boardCard.slice(boardCard.indexOf('<div className="card-top">'));
    const companyIndex = cardMarkup.indexOf('className="card-company"');
    const scoreIndex = cardMarkup.indexOf('className={`score-num');
    const kebabIndex = cardMarkup.indexOf('className="board-card-kebab"');

    expect(companyIndex).toBeGreaterThan(-1);
    expect(scoreIndex).toBeGreaterThan(companyIndex);
    expect(kebabIndex).toBeGreaterThan(scoreIndex);
  });
});
