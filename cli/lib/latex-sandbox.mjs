import { existsSync, realpathSync } from 'node:fs';
import { delimiter, dirname, join } from 'node:path';

function findExecutable(name, envPath = process.env.PATH ?? '') {
  for (const directory of envPath.split(delimiter)) {
    if (!directory) continue;
    const candidate = join(directory, name);
    if (existsSync(candidate)) return realpathSync(candidate);
  }
  return null;
}

function sandboxLiteral(value) {
  return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
}

function minimalEnvironment(sandboxDir, executable) {
  return {
    HOME: sandboxDir,
    LANG: 'C.UTF-8',
    PATH: dirname(executable),
    TEXMFOUTPUT: sandboxDir,
    TMPDIR: sandboxDir,
    openout_any: 'p',
  };
}

export function buildLatexSandboxInvocation({
  sandboxDir: rawSandboxDir,
  platform = process.platform,
  envPath = process.env.PATH ?? '',
  sandboxExecPath = '/usr/bin/sandbox-exec',
}) {
  const sandboxDir = realpathSync(rawSandboxDir);
  const pdflatex = findExecutable('pdflatex', envPath);
  if (!pdflatex) throw new Error('pdflatex is required to generate a LaTeX PDF');

  const pdflatexArgs = [
    '-no-shell-escape',
    '-interaction=nonstopmode',
    '-halt-on-error',
    '-output-directory=.',
    'document.tex',
  ];
  const env = minimalEnvironment(sandboxDir, pdflatex);

  if (platform === 'darwin') {
    if (!existsSync(sandboxExecPath)) {
      throw new Error('secure LaTeX sandbox unavailable: sandbox-exec is missing');
    }
    const readableRoots = [
      '/System',
      '/usr',
      '/Library/TeX',
      '/Library/Fonts',
      '/opt/homebrew',
      '/private/etc/fonts',
      sandboxDir,
    ];
    const profile = [
      '(version 1)',
      '(deny default)',
      '(deny network*)',
      '(allow process*)',
      '(allow sysctl-read)',
      '(allow file-read-metadata)',
      `(allow file-read* ${readableRoots.map(path => `(subpath ${sandboxLiteral(path)})`).join(' ')})`,
      `(allow file-write* (subpath ${sandboxLiteral(sandboxDir)}))`,
    ].join('\n');
    return {
      command: sandboxExecPath,
      args: ['-p', profile, pdflatex, ...pdflatexArgs],
      options: { cwd: sandboxDir, env },
    };
  }

  if (platform === 'linux') {
    const bwrap = findExecutable('bwrap', envPath);
    if (!bwrap) {
      throw new Error(
        'secure LaTeX sandbox unavailable: install bubblewrap (bwrap) before generating PDFs',
      );
    }
    const systemRoots = ['/usr', '/bin', '/lib', '/lib64', '/opt'].filter(existsSync);
    const configRoots = ['/etc/fonts', '/etc/texmf'].filter(existsSync);
    return {
      command: bwrap,
      args: [
        '--die-with-parent',
        '--new-session',
        '--unshare-all',
        '--clearenv',
        '--proc',
        '/proc',
        '--dev',
        '/dev',
        '--tmpfs',
        '/tmp',
        '--dir',
        '/etc',
        '--dir',
        '/work',
        ...systemRoots.flatMap(path => ['--ro-bind', path, path]),
        ...configRoots.flatMap(path => ['--ro-bind', path, path]),
        '--bind',
        sandboxDir,
        '/work',
        '--chdir',
        '/work',
        '--setenv',
        'HOME',
        '/work',
        '--setenv',
        'TMPDIR',
        '/work',
        '--setenv',
        'TEXMFOUTPUT',
        '/work',
        '--setenv',
        'openout_any',
        'p',
        '--setenv',
        'PATH',
        dirname(pdflatex),
        '--setenv',
        'LANG',
        'C.UTF-8',
        pdflatex,
        ...pdflatexArgs,
      ],
      options: { cwd: sandboxDir, env },
    };
  }

  throw new Error(`secure LaTeX sandbox unavailable on ${platform}`);
}
