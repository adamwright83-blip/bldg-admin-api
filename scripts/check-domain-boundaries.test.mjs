import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';

test('relocations preserve existing edges while new callers and targets remain forbidden', () => {
  const root = mkdtempSync(join(tmpdir(), 'domain-relocation-proof-'));
  const git = (...args) => execFileSync('git', args, { cwd: root, stdio: 'pipe' }).toString().trim();
  const put = (path, source) => { mkdirSync(join(root, path, '..'), { recursive: true }); writeFileSync(join(root, path), source); };
  const check = base => spawnSync(process.execPath, ['scripts/check-domain-boundaries.mjs'], { cwd: root, env: { ...process.env, DOMAIN_BOUNDARY_RATCHET_BASE: base }, encoding: 'utf8' });
  try {
    git('init'); git('config', 'user.name', 'Test'); git('config', 'user.email', 'test@example.test');
    put('docs/architecture/domain-boundaries.json', JSON.stringify({ forbiddenImports: [{ id: 'commercial-boundary', from: ['server/commercial'], to: ['server/agents/operator'], reason: 'No new inline mutations' }] }));
    put('server/operator/bridge.ts', 'export const bridge = () => 1;\n');
    put('server/commercial/service.ts', 'import { bridge } from "../operator/bridge";\nexport const run = () => bridge();\n');
    mkdirSync(join(root, 'scripts')); copyFileSync(new URL('./check-domain-boundaries.mjs', import.meta.url), join(root, 'scripts/check-domain-boundaries.mjs'));
    git('add', '.'); git('commit', '-m', 'baseline'); const baseline = git('rev-parse', 'HEAD');
    mkdirSync(join(root, 'server/agents'), { recursive: true }); git('mv', 'server/operator', 'server/agents/operator');
    put('server/commercial/service.ts', 'import { bridge } from "../agents/operator/bridge";\nexport const run = () => bridge();\n');
    git('add', '.'); git('commit', '-m', 'relocation');
    assert.equal(check(baseline).status, 0, 'same historical edge survives target relocation');
    const relocated = git('rev-parse', 'HEAD');
    put('server/commercial/newCaller.ts', 'import { bridge } from "../agents/operator/bridge";\n');
    git('add', '.'); git('commit', '-m', 'new caller');
    assert.equal(check(baseline).status, 1, 'new caller fails even in relocation diff');
    assert.equal(check(relocated).status, 1, 'new caller fails after relocation');
    git('reset', '--hard', relocated);
    put('server/agents/operator/newBridge.ts', 'export const bridge = () => 2;\n');
    put('server/commercial/service.ts', 'import { bridge } from "../agents/operator/newBridge";\nexport const run = () => bridge();\n');
    git('add', '.'); git('commit', '-m', 'new target');
    assert.equal(check(baseline).status, 1, 'new target fails');
    git('reset', '--hard', relocated);
    put('server/commercial/service.ts', 'import { bridge as mutate } from "../agents/operator/bridge";\nexport const run = () => mutate();\n');
    git('add', '.'); git('commit', '-m', 'changed import');
    assert.equal(check(baseline).status, 1, 'changed import form requires review');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
