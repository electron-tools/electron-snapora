import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Expand only Node test files explicitly: Node 20 on Windows does not expand CLI globs.
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const files = [
  ['test/scripts', '.test.mjs'],
  ['test/demo', '.test.cjs'],
].flatMap(([directory, suffix]) =>
  readdirSync(join(root, directory))
    .filter((name) => name.endsWith(suffix))
    .sort()
    .map((name) => join(root, directory, name)),
);
if (files.length === 0) throw new Error('No Node test files found.');
const result = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit', cwd: root });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
