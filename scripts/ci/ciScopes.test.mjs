import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { AREAS, STANDALONE } from './ciAreas.mjs';
import { BASE_JOBS, globToRegExp, jobBlock, outputs, selectScope } from './ciScopes.mjs';

const ROOT = new URL('../../', import.meta.url);
const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 << 20 })
  .split('\0')
  .filter(Boolean);
const trackedSet = new Set(tracked);
const read = file => readFileSync(new URL(file, ROOT), 'utf8');
const ciYml = read('.github/workflows/ci.yml');
const matrix = JSON.parse(read('.github/goldline-fast-smoke-matrix.json'));

/** Selects for `changed` as a pull request would. `added` holds files the change creates, with their source. */
function scope(changed, { added = {}, event = 'pull_request' } = {}) {
  for (const file of changed) {
    if (!(file in added)) assert.ok(trackedSet.has(file), `scenario file ${file} no longer exists; pick another`);
  }
  return selectScope({
    event,
    changed,
    tracked: [...tracked, ...Object.keys(added)],
    read: file => (file in added ? added[file] : read(file)),
  });
}

const ALL_JOBS = [...new Set(['guards', 'story', 'typecheck', 'unit', ...AREAS.map(area => area.job)])];
const HIGH_RISK = ['launch-exam', 'billing', 'intake-http', 'tenant-boundary', 'tenant-lifecycle', 'plan-cogs', 'schema-release'];
const GAMEPLAY = ['goldline-mobile', 'beverly-hills-2d'];

function assertRuns(result, jobs) {
  for (const job of jobs) assert.ok(result.jobs.includes(job), `expected ${job} in ${result.jobs.join(', ')}`);
}
function assertSkips(result, jobs) {
  for (const job of jobs) assert.ok(!result.jobs.includes(job), `did not expect ${job}: ${JSON.stringify(result.areas.get(job))}`);
}

// ── Representative changes ───────────────────────────────────────────────────────────────────

test('docs only: the nomenclature and spoiler guards, nothing else', () => {
  const result = scope(['docs/ci/CI_SCOPES.md', 'README.md', 'artifacts/channel-382/frame-01.png'].filter(f => trackedSet.has(f)).concat('docs/goldline/NEW_NOTE.md'), {
    added: { 'docs/goldline/NEW_NOTE.md': '' },
  });
  assert.deepEqual(result.jobs, ['guards', 'story']);
  assert.equal(result.storyMysql, false);
  assert.equal(result.unit, null);
});

test('a favicon: the guards only, no database exam', () => {
  const result = scope(['client/public/joystick-home/favicon.svg']);
  assert.deepEqual(result.jobs, ['guards', 'story']);
});

test('sign-up and accounts (#812): every account, payment, tenant and migration gate', () => {
  const files = [
    'client/src/App.tsx',
    'client/src/pages/account/SignInPage.tsx',
    'drizzle/0165_joystick_accounts.sql',
    'e2e/first-ten-minutes/signup.spec.ts',
    'scripts/migrate.mjs',
    'server/_core/index.ts',
    'server/_core/systemRouter.ts',
    'server/firstTenMinutes/oauthRoutes.ts',
    'server/joystickAccount/accounts.mysql.integration.test.ts',
    'server/joystickAccount/router.ts',
    'server/joystickAccount/session.ts',
    'server/saas/saasStore.ts',
    'shared/joystickAccount.ts',
  ];
  const added = Object.fromEntries(files.filter(file => !trackedSet.has(file)).map(file => [file, '']));
  added['server/joystickAccount/router.ts'] = 'import { readSession } from "./session";\nimport { saasStore } from "../saas/saasStore";\n';
  const result = scope(files, { added });
  assertRuns(result, ['typecheck', 'unit', ...HIGH_RISK, 'story', 'goldline-smoke', 'legacy-release']);
  assert.equal(result.storyMysql, true);
  assert.equal(result.smokeEntries.length, matrix.length, 'App.tsx and server/_core reach every proof world');
  assert.ok(result.standalone.some(entry => entry.id === 'first-ten-minutes'));
});

test('one account file alone still runs the launch exam and the tenant boundary', () => {
  const result = scope(['server/joystickAccount/session.ts'], { added: { 'server/joystickAccount/session.ts': 'export {};\n' } });
  assertRuns(result, ['typecheck', 'launch-exam', 'tenant-boundary', 'schema-release']);
  assertSkips(result, GAMEPLAY);
});

test('SaaS billing: the billing lifecycle and launch exam, never the game suites', () => {
  const result = scope(['server/saas/saasBilling.ts']);
  assertRuns(result, ['typecheck', 'unit', 'billing', 'launch-exam', 'intake-http', 'plan-cogs', 'schema-release', 'goldline-smoke']);
  assert.equal(result.smokeContracts, true);
  assert.deepEqual(result.smokeEntries, []);
  assertSkips(result, GAMEPLAY);
});

test('order payments: billing, launch exam, resident intake and the payment-admission contracts', () => {
  const file = tracked.find(candidate => /^server\/domains\/payment\/[^/]+\.ts$/.test(candidate) && !/\.test\.ts$/.test(candidate));
  const result = scope([file]);
  assertRuns(result, ['billing', 'launch-exam', 'intake-http', 'goldline-smoke']);
  assert.equal(result.smokeContracts, true);
  assertSkips(result, GAMEPLAY);
});

test('tenant code: the tenant boundary, lifecycle and launch exam', () => {
  const result = scope(['server/platform/tenancy/tenantIdentity.ts']);
  assertRuns(result, ['tenant-boundary', 'tenant-lifecycle', 'launch-exam', 'schema-release']);
  assertSkips(result, GAMEPLAY);
});

test('a shared contract: the type-check, the unit tests importing it, and the suites that name it', () => {
  const result = scope(['shared/goldlineDayLine.ts']);
  assertRuns(result, ['typecheck', 'unit', 'schema-release', 'claire-strategic-preparation']);
  assert.ok(result.unit.tests.length > 0);
  assert.ok(result.unit.tests.every(test => /\.(test|spec)\.ts$/.test(test)));
});

test('Lantern City: its proof world, mobile regression and Beverly Hills; no money or tenant gates', () => {
  const result = scope(['client/src/components/admin/control-room/LanternCitySceneV6/LanternCityScene.tsx']);
  assertRuns(result, ['goldline-smoke', 'goldline-mobile', 'beverly-hills-2d', 'schema-release']);
  assert.ok(result.smokeEntries.includes('fast-smoke-world'));
  assert.ok(!result.smokeEntries.includes('fast-smoke-century-park-east'));
  assertSkips(result, ['launch-exam', 'billing', 'intake-http', 'tenant-boundary', 'tenant-lifecycle', 'plan-cogs', 'procurement']);
});

test('story content: the story tables on MySQL; no money, tenant or game suites', () => {
  const result = scope(['server/story/fixtures/season-0.json']);
  assertRuns(result, ['story']);
  assert.equal(result.storyMysql, true);
  assertSkips(result, ['billing', 'launch-exam', 'tenant-boundary', ...GAMEPLAY, 'goldline-smoke']);
});

test('a database migration: every suite that migrates a disposable MySQL', () => {
  const result = scope(['drizzle/0166_new_table.sql', 'scripts/migrate.mjs'], { added: { 'drizzle/0166_new_table.sql': '' } });
  assertRuns(result, [...HIGH_RISK, 'story', 'goldline-smoke', 'legacy-release', 'sales-intel-teaching-review']);
  assert.equal(result.storyMysql, true);
  assert.equal(result.smokeContracts, true);
  assert.equal(result.smokeEntries.length, matrix.length);
});

test('CI configuration: one suite workflow runs that suite; ci.yml runs everything; the rules run their tests', () => {
  assert.deepEqual(scope(['.github/workflows/saas-billing-lifecycle.yml']).jobs, ['guards', 'story', 'billing']);

  const everything = scope(['.github/workflows/ci.yml']);
  assert.deepEqual(everything.jobs, ALL_JOBS);
  assert.equal(everything.unit.whole, true);

  // ciScopes.test.mjs itself runs in the scope job of every pull request.
  assert.deepEqual(scope(['scripts/ci/ciAreas.mjs']).jobs, ['guards', 'story', 'typecheck']);

  const smoke = scope(['.github/goldline-fast-smoke-matrix.json']);
  assertRuns(smoke, ['goldline-smoke']);
  assert.equal(smoke.smokeEntries.length, matrix.length);

  const unit = scope(['.github/workflows/unit-suite.yml']);
  assert.equal(unit.unit.whole, true);
});

test('a test file runs the suites that run it, not every suite whose paths contain it', () => {
  const result = scope(['server/saas/saasBilling.test.ts']);
  assertRuns(result, ['billing', 'unit']);
  assert.ok(result.unit.tests.includes('server/saas/saasBilling.test.ts'));
  assertSkips(result, ['tenant-lifecycle', 'plan-cogs']);
});

test('dependencies run the full regression', () => {
  for (const file of ['package.json', 'pnpm-lock.yaml']) {
    const result = scope([file]);
    assert.deepEqual(result.jobs, ALL_JOBS, file);
    assert.equal(result.unit.whole, true);
  }
});

test('push to main runs the guards and type-check; nightly and manual runs select everything', () => {
  assert.deepEqual(scope([], { event: 'push' }).jobs, ['guards', 'story', 'typecheck']);
  for (const event of ['schedule', 'workflow_dispatch']) {
    const result = selectScope({ event, changed: null, tracked, read });
    assert.deepEqual(result.jobs, ALL_JOBS, event);
    assert.equal(result.unit.whole, true);
    assert.equal(result.storyMysql, true);
    assert.deepEqual([...result.smokeEntries].sort(), matrix.map(entry => entry.name).sort());
  }
});

test('changed files that cannot be read run everything', () => {
  const result = selectScope({ event: 'pull_request', changed: null, tracked, read });
  assert.deepEqual(result.jobs, ALL_JOBS);
});

test('outputs: shards cover the targeted tests, names are safe to pass to Vitest', () => {
  const result = scope(['shared/goldlineDayLine.ts']);
  const out = outputs(result);
  assert.equal(JSON.parse(out.unit_shards).length, Number(out.unit_shard_total));
  assert.match(out.unit_tests, /^[\w./@+ -]+$/);
  assert.deepEqual(JSON.parse(out.jobs), result.jobs);
});

// ── The table, ci.yml and the workflows agree ──────────────────────────────────────────────

test('every area has a ci.yml job that calls its workflow behind its own condition', () => {
  for (const area of AREAS) {
    const block = jobBlock(ciYml, area.job);
    assert.match(block, new RegExp(`uses: \\./\\.github/workflows/${area.workflow.replace('.', '\\.')}`), area.id);
    // story always runs (its spoiler guard); the area only turns on its MySQL job.
    if (BASE_JOBS.includes(area.job)) continue;
    assert.match(block, new RegExp(`contains\\(fromJSON\\(needs\\.scope\\.outputs\\.jobs \\|\\| '\\[\\]'\\), '${area.job}'\\)`), area.id);
  }
});

test('merge-gate waits for every job and always runs', () => {
  const gate = jobBlock(ciYml, 'merge-gate');
  assert.match(gate, /if: always\(\)/);
  const jobsSection = ciYml.slice(ciYml.indexOf('\njobs:\n'));
  const jobs = [...jobsSection.matchAll(/^ {2}([\w-]+):\s*$/gm)].map(match => match[1]).filter(job => job !== 'merge-gate');
  for (const job of jobs) assert.match(gate, new RegExp(`^ {6}- ${job}$`, 'm'), job);
  for (const job of ALL_JOBS) assert.ok(jobs.includes(job), `ci.yml has no ${job} job`);
});

test('every Fast Goldline browser entry belongs to exactly one area', () => {
  const named = AREAS.filter(area => area.smokeEntry).map(area => area.smokeEntry);
  assert.deepEqual([...named].sort(), matrix.map(entry => entry.name).sort());
});

test('only ci.yml (and the standalone suites) start on pull_request', () => {
  const allowed = new Set(['ci.yml', 'cancel-closed-pr-runs.yml', ...STANDALONE.map(entry => entry.workflow)]);
  for (const file of tracked.filter(candidate => /^\.github\/workflows\/[^/]+\.ya?ml$/.test(candidate))) {
    const on = read(file).split('\n').findIndex(line => line.startsWith('on:'));
    const lines = read(file).split('\n');
    let end = on + 1;
    while (end < lines.length && (lines[end] === '' || /^\s/.test(lines[end]))) end++;
    const triggers = lines.slice(on, end).join('\n');
    const name = file.split('/').pop();
    if (/^ {2}pull_request(_target)?:/m.test(triggers)) assert.ok(allowed.has(name), `${name} triggers on pull_request; give it an area in ciAreas.mjs instead`);
    if (AREAS.some(area => area.workflow === name)) assert.match(triggers, /^ {2}workflow_call:/m, name);
  }
});

test('every area reaches something: paths or roots', () => {
  for (const area of AREAS) assert.ok((area.paths ?? []).length || area.roots || area.workflow, area.id);
});

test('globs follow GitHub paths-filter rules', () => {
  assert.ok(globToRegExp('docs/**').test('docs/a/b.md'));
  assert.ok(globToRegExp('**/*.md').test('README.md'));
  assert.ok(globToRegExp('**/*.md').test('server/story/README.md'));
  assert.ok(!globToRegExp('shared/beverlyHills*').test('shared/beverlyHills/x.ts'));
  assert.ok(globToRegExp('server/**/*[Bb]illing*').test('server/saasBilling.ts'));
  assert.ok(globToRegExp('**/*.test.{ts,tsx,mjs}').test('client/src/x.test.tsx'));
  assert.ok(!globToRegExp('client/public/goldline/dayline-v2').test('client/public/goldline/dayline-v2/a.png'));
});
