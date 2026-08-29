import { delimiter } from 'node:path';
import { describe, expect, it } from 'vitest';
import { providerCliPath } from '../cli-path';

describe('providerCliPath', () => {
  it('preserves inherited precedence and appends every supported provider install location', () => {
    const path = providerCliPath(
      { PATH: '/custom/bin:/usr/bin' },
      { home: '/home/jobseeker', execPath: '/runtime/node/bin/node', platform: 'linux' },
    ).split(delimiter);

    expect(path.slice(0, 2)).toEqual(['/custom/bin', '/usr/bin']);
    expect(path).toContain('/home/jobseeker/.local/bin'); // Claude Code + Codex standalone
    expect(path).toContain('/home/jobseeker/.opencode/bin'); // OpenCode installer
    expect(path).toContain('/home/jobseeker/.npm-global/bin'); // npm global prefix
    expect(path).toContain('/runtime/node/bin'); // npm global beside the active Node runtime
  });

  it('deduplicates locations already present in PATH', () => {
    const path = providerCliPath(
      { PATH: '/home/jobseeker/.local/bin:/usr/bin' },
      { home: '/home/jobseeker', execPath: '/usr/bin/node', platform: 'linux' },
    ).split(delimiter);

    expect(path.filter(entry => entry === '/home/jobseeker/.local/bin')).toHaveLength(1);
    expect(path.filter(entry => entry === '/usr/bin')).toHaveLength(1);
  });
});
