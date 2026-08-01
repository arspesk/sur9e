import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const pipelineCss = readFileSync(join(root, 'src/app/styles/pipeline-inline.css'), 'utf8');
const boardCard = readFileSync(join(root, 'src/features/pipeline/board-card.tsx'), 'utf8');

function allDeclarationsFor(source: string, selector: string): Map<string, string>[] {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const matches = [
    ...source.matchAll(new RegExp(`(?:^|\\n)\\s*${escapedSelector}\\s*\\{([^}]*)\\}`, 'g')),
  ];

  return matches.map(match => {
    const blockWithoutComments = match[1].replace(/\/\*[\s\S]*?\*\//g, '');
    return new Map(
      [...blockWithoutComments.matchAll(/(?:^|;)\s*([\w-]+)\s*:\s*([^;]+?)\s*(?=;|$)/g)].map(
        declaration => [declaration[1], declaration[2].trim()],
      ),
    );
  });
}

function declarationsFor(source: string, selector: string): Map<string, string> {
  const matches = allDeclarationsFor(source, selector);
  expect(matches, `Expected exactly one CSS rule for ${selector}`).toHaveLength(1);
  return matches[0];
}

interface DirectJsxChild {
  tag: string;
  className: string | null;
}

function classNameFor(element: ts.JsxOpeningLikeElement, sourceFile: ts.SourceFile): string | null {
  for (const property of element.attributes.properties) {
    if (!ts.isJsxAttribute(property) || property.name.getText(sourceFile) !== 'className') continue;
    const initializer = property.initializer;
    if (!initializer) return null;
    if (ts.isStringLiteral(initializer)) return initializer.text;
    if (!ts.isJsxExpression(initializer) || !initializer.expression) return null;
    if (
      ts.isStringLiteral(initializer.expression) ||
      ts.isNoSubstitutionTemplateLiteral(initializer.expression)
    ) {
      return initializer.expression.text;
    }
    if (ts.isTemplateExpression(initializer.expression)) {
      return initializer.expression.getText(sourceFile).slice(1, -1);
    }
    return null;
  }
  return null;
}

function cardIdLineShape(source: string): { directChildren: DirectJsxChild[]; end: number } {
  const sourceFile = ts.createSourceFile(
    'board-card.tsx',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  let cardIdLine: ts.JsxElement | undefined;

  function visit(node: ts.Node) {
    if (ts.isJsxElement(node) && classNameFor(node.openingElement, sourceFile) === 'card-id-line') {
      cardIdLine = node;
      return;
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  expect(cardIdLine, 'Expected .card-id-line JSX').toBeDefined();
  if (!cardIdLine) throw new Error('Expected .card-id-line JSX');

  const directChildren = cardIdLine.children
    .filter(
      (child): child is ts.JsxElement | ts.JsxSelfClosingElement =>
        ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child),
    )
    .map(child => {
      const opening = ts.isJsxElement(child) ? child.openingElement : child;
      return {
        tag: opening.tagName.getText(sourceFile),
        className: classNameFor(opening, sourceFile),
      };
    });

  return { directChildren, end: cardIdLine.end };
}

describe('pipeline card style contract', () => {
  it('does not treat nested spans as direct identity-line children', () => {
    const nestedFixture = `
      const card = (
        <div className="card-id-line">
          <div className="unexpected-wrapper">
            <span className="card-company">Acme</span>
            <span className={\`score-num high\`}>5.0</span>
          </div>
        </div>
      );
    `;
    const { directChildren } = cardIdLineShape(nestedFixture);

    expect(directChildren).toEqual([{ tag: 'div', className: 'unexpected-wrapper' }]);
  });

  it('keeps the score beside a shrinkable company name and clear of the overflow menu', () => {
    const column = allDeclarationsFor(pipelineCss, '.column').find(
      declarations => declarations.get('flex') === '0 0 340px',
    );
    const cardIdLine = declarationsFor(pipelineCss, '.card-id-line');
    const cardCompany = declarationsFor(pipelineCss, '.card-company');
    const scoreNum = declarationsFor(pipelineCss, '.card .score-num');

    expect(column, 'Expected the base 340px pipeline column rule').toBeDefined();
    expect(column?.get('min-width')).toBe('0');
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
    const { directChildren, end } = cardIdLineShape(boardCard);
    const kebabIndex = boardCard.indexOf('className="board-card-kebab"', end);

    expect(directChildren).toEqual([
      { tag: 'span', className: 'card-company' },
      { tag: 'span', className: 'score-num ${scoreLevel(score)}' },
    ]);
    expect(kebabIndex).toBeGreaterThan(end);
  });
});
