import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';

function createFixtureRepo() {
  const root = mkdtempSync(join(tmpdir(), 'domain-boundary-fixture-'));
  const git = (...args) => execFileSync('git', args, { cwd: root, stdio: 'pipe' }).toString().trim();
  const put = (path, source) => {
    mkdirSync(join(root, path, '..'), { recursive: true });
    writeFileSync(join(root, path), source);
  };
  const check = base => spawnSync(process.execPath, ['scripts/check-domain-boundaries.mjs'], {
    cwd: root,
    env: { ...process.env, DOMAIN_BOUNDARY_RATCHET_BASE: base },
    encoding: 'utf8',
  });

  git('init');
  git('config', 'user.name', 'Test');
  git('config', 'user.email', 'test@example.test');

  mkdirSync(join(root, 'docs/architecture'), { recursive: true });
  copyFileSync(
    new URL('../docs/architecture/domain-boundaries.json', import.meta.url),
    join(root, 'docs/architecture/domain-boundaries.json')
  );
  mkdirSync(join(root, 'scripts'), { recursive: true });
  copyFileSync(
    new URL('./check-domain-boundaries.mjs', import.meta.url),
    join(root, 'scripts/check-domain-boundaries.mjs')
  );

  return { root, git, put, check, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

// Relocation baseline proof from original test
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

// Prohibited canonical write targets (Tests 1-5)
const writeTargets = [
  {
    targetName: 'orderLifecycleService',
    callerPath: 'server/experience/lanternCity/objectiveOrderSync.ts',
    targetPath: 'server/domains/orders/orderLifecycleService',
    importSpecifier: '../../domains/orders/orderLifecycleService',
    symbolName: 'transitionNativeOrderStatus',
  },
  {
    targetName: 'orderOwnership',
    callerPath: 'server/experience/goldline/world/residentOrderView.ts',
    targetPath: 'server/domains/orders/orderOwnership',
    importSpecifier: '../../../domains/orders/orderOwnership',
    symbolName: 'createOrReuseResidentOrder',
  },
  {
    targetName: 'paymentAdmission',
    callerPath: 'server/experience/goldline/modes/towerWars/combatPayment.ts',
    targetPath: 'server/domains/payment/paymentAdmission',
    importSpecifier: '../../../../domains/payment/paymentAdmission',
    symbolName: 'admitNativePayment',
  },
  {
    targetName: 'commercialPipelineService',
    callerPath: 'server/experience/lanternCity/commercialMissionSync.ts',
    targetPath: 'server/domains/commercial/commercialPipelineService',
    importSpecifier: '../../domains/commercial/commercialPipelineService',
    symbolName: 'recordCommercialWonConversion',
  },
  {
    targetName: 'commercialPipelineCore',
    callerPath: 'server/experience/narratorOs/narratorStageSync.ts',
    targetPath: 'server/domains/commercial/commercialPipelineCore',
    importSpecifier: '../../domains/commercial/commercialPipelineCore',
    symbolName: 'executePipelineTransition',
  },
];

for (const wt of writeTargets) {
  test(`new Experience import of ${wt.targetName} fails with diagnostic and passes upon removal`, () => {
    const repo = createFixtureRepo();
    try {
      repo.put(wt.callerPath, 'export const entry = () => "clean baseline";\n');
      repo.git('add', '.');
      repo.git('commit', '-m', `baseline before ${wt.targetName}`);
      const baseline = repo.git('rev-parse', 'HEAD');

      // 1. Prohibited import added -> nonzero exit code, diagnostic identifies rule
      repo.put(
        wt.callerPath,
        `import { ${wt.symbolName} } from "${wt.importSpecifier}";\nexport const entry = () => ${wt.symbolName}();\n`
      );
      repo.git('add', '.');
      repo.git('commit', '-m', `add prohibited import of ${wt.targetName}`);
      const failRes = repo.check(baseline);

      assert.notEqual(failRes.status, 0, `importing ${wt.targetName} must fail`);
      const combinedOutput = failRes.stderr + failRes.stdout;
      assert.match(
        combinedOutput,
        /game-does-not-import-business-implementation/,
        `diagnostic must identify game-does-not-import-business-implementation for ${wt.targetName}`
      );
      assert.match(
        combinedOutput,
        new RegExp(`${wt.callerPath} -> ${wt.importSpecifier}`),
        `diagnostic must name caller and target for ${wt.targetName}`
      );

      // 2. Removal of prohibited import -> restores status 0
      repo.put(wt.callerPath, 'export const entry = () => "clean restored";\n');
      repo.git('add', '.');
      repo.git('commit', '-m', `remove prohibited import of ${wt.targetName}`);
      const passRes = repo.check(baseline);

      assert.equal(passRes.status, 0, `removing prohibited import of ${wt.targetName} must restore passing result`);
    } finally {
      repo.cleanup();
    }
  });
}

// 6. Relative imports with and without supported source extensions
test('relative imports with and without supported source extensions (.ts, .js, bare) are detected', () => {
  const repo = createFixtureRepo();
  const caller = 'server/experience/extensionVariants.ts';
  try {
    repo.put(caller, 'export const base = 1;\n');
    repo.git('add', '.');
    repo.git('commit', '-m', 'baseline for extension check');
    const baseline = repo.git('rev-parse', 'HEAD');

    const extensions = [
      '',      // bare specifier
      '.ts',   // typescript source extension
      '.js',   // emitted/esm import specifier
      '.mjs',  // esm extension
    ];

    for (const ext of extensions) {
      const specifier = `../domains/orders/orderLifecycleService${ext}`;
      repo.put(
        caller,
        `import { transitionNativeOrderStatus } from "${specifier}";\nexport const run = () => transitionNativeOrderStatus();\n`
      );
      repo.git('add', '.');
      repo.git('commit', '-m', `import with extension "${ext}"`);

      const result = repo.check(baseline);
      assert.notEqual(result.status, 0, `import with specifier "${specifier}" must be detected and fail`);
      const output = result.stderr + result.stdout;
      assert.match(
        output,
        /game-does-not-import-business-implementation/,
        `import "${specifier}" must trigger game-does-not-import-business-implementation`
      );

      // Clean up for next extension test
      repo.git('reset', '--hard', baseline);
    }
  } finally {
    repo.cleanup();
  }
});

// 7. Static-string import() of a protected implementation fails
test('static-string import() of protected business implementation fails and passes upon removal', () => {
  const repo = createFixtureRepo();
  const caller = 'server/experience/dynamicLoader.ts';
  try {
    repo.put(caller, 'export const load = async () => null;\n');
    repo.git('add', '.');
    repo.git('commit', '-m', 'baseline for dynamic import');
    const baseline = repo.git('rev-parse', 'HEAD');

    // Add static-string dynamic import
    repo.put(
      caller,
      'export const load = async () => {\n  const mod = await import("../domains/payment/paymentAdmission");\n  return mod;\n};\n'
    );
    repo.git('add', '.');
    repo.git('commit', '-m', 'add static import()');

    const failRes = repo.check(baseline);
    assert.notEqual(failRes.status, 0, 'static import() of paymentAdmission must fail');
    const output = failRes.stderr + failRes.stdout;
    assert.match(
      output,
      /game-does-not-import-business-implementation/,
      'diagnostic must identify game-does-not-import-business-implementation on static import()'
    );

    // Also verify static import with .ts extension
    repo.put(
      caller,
      'export const load = async () => {\n  const mod = await import("../domains/payment/paymentAdmission.ts");\n  return mod;\n};\n'
    );
    repo.git('add', '.');
    repo.git('commit', '-m', 'add static import() with .ts');

    const failResExt = repo.check(baseline);
    assert.notEqual(failResExt.status, 0, 'static import() with .ts of paymentAdmission must fail');

    // Removing the import restores passing result
    repo.put(caller, 'export const load = async () => "clean restored";\n');
    repo.git('add', '.');
    repo.git('commit', '-m', 'remove static import()');

    const passRes = repo.check(baseline);
    assert.equal(passRes.status, 0, 'removing static import() must restore passing result');
  } finally {
    repo.cleanup();
  }
});

// 8. New import of legal read services passes
test('new Experience import of legal nativePaymentReadService and other read services passes', () => {
  const repo = createFixtureRepo();
  const caller = 'server/experience/factConsumer.ts';
  try {
    repo.put(caller, 'export const facts = () => [];\n');
    repo.git('add', '.');
    repo.git('commit', '-m', 'baseline for read service import');
    const baseline = repo.git('rev-parse', 'HEAD');

    // Import legal read services
    repo.put(
      caller,
      [
        'import { readNativePaymentFacts } from "../domains/payment/nativePaymentReadService";',
        'import { readNativeCustomerHistory } from "../domains/orders/orderHistoryReadService";',
        'import { listTenantUnpaidOrders } from "../domains/orders/unpaidOrderReadService";',
        'import { listCommercialAccountRefs } from "../domains/commercial/commercialAccountReadService";',
        'import { listOpenCommercialFollowUps } from "../domains/commercial/commercialFollowUpReadService";',
        'export const consume = () => ({ readNativePaymentFacts, readNativeCustomerHistory, listTenantUnpaidOrders, listCommercialAccountRefs, listOpenCommercialFollowUps });',
      ].join('\n') + '\n'
    );
    repo.git('add', '.');
    repo.git('commit', '-m', 'import read services');

    const result = repo.check(baseline);
    assert.equal(result.status, 0, `importing legal read services must pass without violation: ${result.stderr}`);
    assert.match(result.stdout, /passed/i);
  } finally {
    repo.cleanup();
  }
});

// 9. Pre-existing import is not rejected merely because the manifest was updated
test('pre-existing import is not rejected merely because the manifest was updated', () => {
  const root = mkdtempSync(join(tmpdir(), 'domain-pre-existing-proof-'));
  const git = (...args) => execFileSync('git', args, { cwd: root, stdio: 'pipe' }).toString().trim();
  const put = (path, source) => { mkdirSync(join(root, path, '..'), { recursive: true }); writeFileSync(join(root, path), source); };
  const check = base => spawnSync(process.execPath, ['scripts/check-domain-boundaries.mjs'], { cwd: root, env: { ...process.env, DOMAIN_BOUNDARY_RATCHET_BASE: base }, encoding: 'utf8' });
  try {
    git('init'); git('config', 'user.name', 'Test'); git('config', 'user.email', 'test@example.test');
    // Baseline manifest with limited protected write targets
    put(
      'docs/architecture/domain-boundaries.json',
      JSON.stringify({
        forbiddenImports: [
          {
            id: 'game-does-not-import-business-implementation',
            from: ['server/experience'],
            to: ['server/commercialMissions'],
            reason: 'Game consumes read models',
          },
        ],
      })
    );
    mkdirSync(join(root, 'scripts'));
    copyFileSync(new URL('./check-domain-boundaries.mjs', import.meta.url), join(root, 'scripts/check-domain-boundaries.mjs'));

    // Existing caller already has import of orderLifecycleService (debt that existed prior to manifest update)
    put(
      'server/experience/historicalModule.ts',
      'import { transitionNativeOrderStatus } from "../domains/orders/orderLifecycleService";\nexport const run = () => transitionNativeOrderStatus();\n'
    );
    git('add', '.'); git('commit', '-m', 'baseline with pre-existing dependency');
    const baseline = git('rev-parse', 'HEAD');

    // Update manifest to add orderLifecycleService to the rule's `to` list
    put(
      'docs/architecture/domain-boundaries.json',
      JSON.stringify({
        forbiddenImports: [
          {
            id: 'game-does-not-import-business-implementation',
            from: ['server/experience'],
            to: [
              'server/commercialMissions',
              'server/domains/orders/orderLifecycleService',
            ],
            reason: 'Game consumes read models',
          },
        ],
      })
    );
    git('add', 'docs/architecture/domain-boundaries.json');
    git('commit', '-m', 'update manifest rule without touching historicalModule');

    // Historical caller was not touched in git diff -> check passes
    const result = check(baseline);
    assert.equal(
      result.status,
      0,
      `pre-existing import in untouched file must not fail merely because manifest was updated: ${result.stderr}`
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// 10. Legitimate Git-recognized relocation preserving same semantic import passes under relocation logic
test('legitimate Git-recognized relocation preserving same semantic import passes under relocation logic', () => {
  const root = mkdtempSync(join(tmpdir(), 'domain-experience-relocation-proof-'));
  const git = (...args) => execFileSync('git', args, { cwd: root, stdio: 'pipe' }).toString().trim();
  const put = (path, source) => { mkdirSync(join(root, path, '..'), { recursive: true }); writeFileSync(join(root, path), source); };
  const check = base => spawnSync(process.execPath, ['scripts/check-domain-boundaries.mjs'], { cwd: root, env: { ...process.env, DOMAIN_BOUNDARY_RATCHET_BASE: base }, encoding: 'utf8' });
  try {
    git('init'); git('config', 'user.name', 'Test'); git('config', 'user.email', 'test@example.test');
    put(
      'docs/architecture/domain-boundaries.json',
      JSON.stringify({
        forbiddenImports: [
          {
            id: 'game-does-not-import-business-implementation',
            from: ['server/experience'],
            to: ['server/domains/orders/orderLifecycleService'],
            reason: 'Game consumes read models',
          },
        ],
      })
    );
    put('server/domains/orders/orderLifecycleService.ts', 'export const transitionNativeOrderStatus = () => {};\n');
    put(
      'server/experience/oldFeature.ts',
      [
        'import { transitionNativeOrderStatus } from "../domains/orders/orderLifecycleService";',
        'export const item1 = 1;',
        'export const item2 = 2;',
        'export const item3 = 3;',
        'export const run = () => transitionNativeOrderStatus();',
      ].join('\n') + '\n'
    );
    mkdirSync(join(root, 'scripts'));
    copyFileSync(new URL('./check-domain-boundaries.mjs', import.meta.url), join(root, 'scripts/check-domain-boundaries.mjs'));
    git('add', '.'); git('commit', '-m', 'baseline');
    const baseline = git('rev-parse', 'HEAD');

    // Legitimate git rename of caller to nested directory with adjusted specifier
    mkdirSync(join(root, 'server/experience/sub'), { recursive: true });
    git('mv', 'server/experience/oldFeature.ts', 'server/experience/sub/newFeature.ts');
    put(
      'server/experience/sub/newFeature.ts',
      [
        'import { transitionNativeOrderStatus } from "../../domains/orders/orderLifecycleService";',
        'export const item1 = 1;',
        'export const item2 = 2;',
        'export const item3 = 3;',
        'export const run = () => transitionNativeOrderStatus();',
      ].join('\n') + '\n'
    );
    git('add', '.'); git('commit', '-m', 'relocate caller file');

    // Proven relocation evidence recognizes identical semantic import line
    const relocationRes = check(baseline);
    assert.equal(
      relocationRes.status,
      0,
      `legitimate git-recognized relocation must pass under relocation logic: ${relocationRes.stderr}`
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
