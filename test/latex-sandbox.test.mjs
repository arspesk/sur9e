import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildLatexSandboxInvocation } from '../cli/lib/latex-sandbox.mjs';

function fakePath(root, names) {
  for (const name of names) mkdirSync(join(root, name), { recursive: true });
  return names.map(name => join(root, name)).join(':');
}

describe('LaTeX compiler sandbox', () => {
  it('fails closed when Linux bubblewrap is unavailable', () => {
    const root = mkdtempSync(join(tmpdir(), 'latex-sandbox-'));
    const path = fakePath(root, ['bin']);
    mkdirSync(join(root, 'work'));
    writeFileSync(join(root, 'bin', 'pdflatex'), '');

    expect(() =>
      buildLatexSandboxInvocation({
        sandboxDir: join(root, 'work'),
        platform: 'linux',
        envPath: path,
      }),
    ).toThrow(/install bubblewrap/);
  });

  it.each(['linux', 'darwin'])('fails closed when pdflatex is unavailable on %s', platform => {
    const root = mkdtempSync(join(tmpdir(), 'latex-sandbox-'));
    const bin = join(root, 'bin');
    const work = join(root, 'work');
    mkdirSync(bin);
    mkdirSync(work);

    expect(() =>
      buildLatexSandboxInvocation({
        sandboxDir: work,
        platform,
        envPath: bin,
        sandboxExecPath: join(bin, 'sandbox-exec'),
      }),
    ).toThrow(/pdflatex is required/);
  });

  it('builds a network-isolated Linux bubblewrap invocation', () => {
    const root = mkdtempSync(join(tmpdir(), 'latex-sandbox-'));
    const bin = join(root, 'bin');
    const work = join(root, 'work');
    mkdirSync(bin);
    mkdirSync(work);
    writeFileSync(join(bin, 'pdflatex'), '');
    writeFileSync(join(bin, 'bwrap'), '');

    const invocation = buildLatexSandboxInvocation({
      sandboxDir: work,
      platform: 'linux',
      envPath: bin,
    });

    expect(invocation.args).toContain('--unshare-all');
    expect(invocation.args).toContain('--clearenv');
    expect(invocation.args).toEqual(
      expect.arrayContaining(['--bind', expect.any(String), '/work', '--chdir', '/work']),
    );
  });

  it('uses macOS sandbox-exec with network denied and a scrubbed environment', () => {
    const root = mkdtempSync(join(tmpdir(), 'latex-sandbox-'));
    const bin = join(root, 'bin');
    const work = join(root, 'work');
    mkdirSync(bin);
    mkdirSync(work);
    const pdflatex = join(bin, 'pdflatex');
    const sandboxExec = join(bin, 'sandbox-exec');
    writeFileSync(pdflatex, '');
    writeFileSync(sandboxExec, '');

    const invocation = buildLatexSandboxInvocation({
      sandboxDir: work,
      platform: 'darwin',
      envPath: bin,
      sandboxExecPath: sandboxExec,
    });

    expect(invocation.command).toBe(sandboxExec);
    expect(invocation.args).toContain('-no-shell-escape');
    expect(invocation.args.join(' ')).toContain('deny network');
    expect(invocation.options.env).toEqual({
      HOME: expect.any(String),
      LANG: 'C.UTF-8',
      PATH: expect.any(String),
      TEXMFOUTPUT: expect.any(String),
      TMPDIR: expect.any(String),
      openout_any: 'p',
    });
    expect(invocation.options.env).not.toHaveProperty('OPENAI_API_KEY');
  });
});
