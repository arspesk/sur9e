// SPDX-License-Identifier: MIT

function decodeGitOutput(output) {
  if (typeof output === 'string') return output;
  if (Buffer.isBuffer(output) || output instanceof Uint8Array) {
    return Buffer.from(output).toString('utf8');
  }
  throw new TypeError('Git output must be a string, Buffer, or Uint8Array');
}

export function parseNulPaths(output) {
  const records = decodeGitOutput(output).split('\0');
  if (records.at(-1) === '') records.pop();
  return records;
}

export function parsePorcelainV1Z(output) {
  const records = parseNulPaths(output);
  const entries = [];

  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (record.length < 3 || record[2] !== ' ') {
      throw new Error('Invalid Git porcelain v1 -z record');
    }

    const code = record.slice(0, 2);
    entries.push({ code, path: record.slice(3) });

    if (/[RC]/u.test(code)) {
      index += 1;
      if (index >= records.length) {
        throw new Error('Git porcelain rename/copy record is missing source path');
      }
      entries.push({ code, path: records[index] });
    }
  }

  return entries;
}
