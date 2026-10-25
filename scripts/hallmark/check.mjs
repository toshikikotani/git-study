/** Run the pinned, project-local Hallmark app audit. No network or application data is required for static checks. */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = fileURLToPath(new URL('../../', import.meta.url));
const checker = resolve(root, '.agents/skills/hallmark/scripts/sloplint.mjs');
const result = spawnSync(
  process.execPath,
  [
    checker,
    'app',
    'src/components',
    '--scope',
    'app',
    '--genre',
    'modern-minimal',
    ...process.argv.slice(2),
  ],
  { cwd: root, stdio: 'inherit' },
);
if (result.error) {
  process.stderr.write(`Hallmarkを起動できませんでした: ${result.error.message}\n`);
  process.exit(1);
}
process.exit(result.status ?? 1);
