/**
 * Thin wrapper that invokes `bun test` with a specific path.
 * Used by test:integration and test:e2e scripts to avoid recursive script invocation.
 *
 * Usage (via package.json):
 *   bun --env-file .env.test run scripts/test-runner.ts tests/integration/
 */
const path = process.argv[2];
if (!path) {
  console.error('Usage: bun run scripts/test-runner.ts <test-path>');
  process.exit(1);
}

const proc = Bun.spawn(['bun', 'test', path], {
  stdout: 'inherit',
  stderr: 'inherit',
  env: process.env,
});
const code = await proc.exited;
process.exit(code);
