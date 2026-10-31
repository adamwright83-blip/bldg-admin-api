import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';

function createFixtureRepo() {
  const root = mkdtempSync(join(tmpdir(), 'default-tenant-ratchet-fixture-'));
  const git = (...args) => execFileSync('git', args, { cwd: root, stdio: 'pipe', maxBuffer: 1 << 28 }).toString().trim();
  const put = (path, source) => {
    mkdirSync(join(root, path, '..'), { recursive: true });
    writeFileSync(join(root, path), source);
  };
  const check = base => spawnSync(process.execPath, ['scripts/check-default-tenant-ratchet.mjs'], {
    cwd: root,
    env: { ...process.env, DEFAULT_TENANT_RATCHET_BASE: base },
    encoding: 'utf8',
  });

  git('init');
  git('config', 'user.name', 'Test');
  git('config', 'user.email', 'test@example.test');
  mkdirSync(join(root, 'scripts'), { recursive: true });
  copyFileSync(
    new URL('./check-default-tenant-ratchet.mjs', import.meta.url),
    join(root, 'scripts/check-default-tenant-ratchet.mjs')
  );

  return { root, git, put, check, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

// client/public/joystick-landing-standalone.html is one 3.6 MB generated line, so a
// one-word edit there produces a --unified=0 diff larger than execFileSync's 1 MB default.
const singleLineExport = word =>
  `<main>${'a'.repeat(1536 * 1024)} ${word} ${'b'.repeat(1536 * 1024)}</main>\n`;

test('an edit to a multi-megabyte single-line export does not crash the ratchet', () => {
  const repo = createFixtureRepo();
  try {
    repo.put('client/public/standalone-export.html', singleLineExport('$49/month'));
    repo.put('server/tenantScoped.ts', 'export const read = (tenantId: string) => tenantId;\n');
    repo.git('add', '.');
    repo.git('commit', '-m', 'baseline');
    const baseline = repo.git('rev-parse', 'HEAD');

    repo.put('client/public/standalone-export.html', singleLineExport('$79/month'));
    repo.git('add', '.');
    repo.git('commit', '-m', 'price edit inside the giant line');
    const diffBytes = Buffer.byteLength(repo.git('diff', '--unified=0', baseline, 'HEAD', '--', 'client'));
    assert.ok(diffBytes > 1024 * 1024, `fixture diff must exceed the 1 MB default (was ${diffBytes})`);

    const result = repo.check(baseline);
    assert.doesNotMatch(result.stderr, /ENOBUFS|Unable to compute/, result.stderr);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /\+0 \/ -0 \/ delta 0/);
  } finally {
    repo.cleanup();
  }
});

test('a new default-tenant fallback beside a multi-megabyte single-line edit still fails', () => {
  const repo = createFixtureRepo();
  try {
    repo.put('client/public/standalone-export.html', singleLineExport('$49/month'));
    repo.put('server/tenantScoped.ts', 'export const read = (tenantId: string) => tenantId;\n');
    repo.git('add', '.');
    repo.git('commit', '-m', 'baseline');
    const baseline = repo.git('rev-parse', 'HEAD');

    repo.put('client/public/standalone-export.html', singleLineExport('$79/month'));
    repo.put(
      'server/tenantScoped.ts',
      'export const read = (input: { tenantId?: string }) => input.tenantId ?? "default";\n'
    );
    repo.git('add', '.');
    repo.git('commit', '-m', 'giant edit plus new fallback');

    const result = repo.check(baseline);
    assert.doesNotMatch(result.stderr, /ENOBUFS|Unable to compute/);
    assert.equal(result.status, 1, `new fallback must fail, not crash: ${result.stderr}`);
    assert.match(result.stdout, /\+1 \/ -0 \/ delta 1/);
    assert.match(result.stdout, /server\/tenantScoped\.ts/);
  } finally {
    repo.cleanup();
  }
});
