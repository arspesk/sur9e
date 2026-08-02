import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

describe('settings UI style contract', () => {
  it('keeps native numeric steppers visually compact', () => {
    const settingsCss = readFileSync(join(root, 'src/app/styles/settings-inline.css'), 'utf8');

    expect(settingsCss).toMatch(
      /\.settings-content \.form-input\[type="number"\]::-webkit-inner-spin-button\s*\{[\s\S]*?transform:\s*scale\(0\.75\);[\s\S]*?transform-origin:\s*center right/,
    );
  });
});
