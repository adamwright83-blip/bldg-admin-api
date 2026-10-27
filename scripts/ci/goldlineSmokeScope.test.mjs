import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { selectEntries, smokeScope } from './goldlineSmokeScope.mjs';

const entries = JSON.parse(
  readFileSync(new URL('../../.github/goldline-fast-smoke-matrix.json', import.meta.url), 'utf8')
);

test('every matrix entry is complete and scoped', () => {
  assert.equal(entries.length, 8);
  for (const entry of entries) {
    assert.ok(entry.name && entry.command && entry.timeout > 0, entry.name);
    assert.ok(['core', 'world'].includes(entry.scope), entry.name);
  }
  assert.deepEqual(
    entries.filter(entry => entry.scope === 'core').map(entry => entry.name),
    ['fast-smoke-world', 'fast-smoke-territories', 'fast-smoke-campaign']
  );
});

test('docs and artifacts alone run no browser job', () => {
  assert.equal(smokeScope(['docs/goldline/PLAN.md', 'artifacts/x/shot.png', 'AGENTS.md']), 'none');
  assert.deepEqual(selectEntries(entries, 'none'), []);
});

test('unrelated server areas keep the core worlds and drop the world-specific ones', () => {
  // #732 and #705 from 2026-10-26
  assert.equal(
    smokeScope([
      '.github/workflows/cleancloud-late-sales.yml',
      'docs/verification/CLEANCLOUD_LATE_SALES.md',
      'server/integrations/cleancloud/browserSync/cleancloudDirectSync.ts',
    ]),
    'core'
  );
  assert.equal(smokeScope(['server/mitch/executorSmokeOrder.ts', 'server/president/fabric/invariants.test.ts']), 'core');
  assert.equal(selectEntries(entries, 'core').length, 3);
});

test('anything else, including unknown paths, runs every job', () => {
  for (const file of [
    'client/src/components/driver/CommandCenter.tsx',
    'shared/missionCompletionPath.ts',
    'server/claire/businessConversation.ts',
    'server/saas/saasRouter.ts',
    'server/somethingNew/index.ts',
    'package.json',
    'pnpm-lock.yaml',
    '.github/workflows/goldline-fast-smoke.yml',
    '.github/goldline-fast-smoke-matrix.json',
    'scripts/ci/goldlineSmokeScope.mjs',
  ]) {
    assert.equal(smokeScope(['docs/a.md', 'server/mitch/a.ts', file]), 'all', file);
  }
  assert.equal(smokeScope(null), 'all');
  assert.equal(selectEntries(entries, 'all').length, 8);
});
