import { test } from 'node:test';
import assert from 'node:assert/strict';
import { judge } from './mergeGate.mjs';

const needs = (jobs, results, scopeResult = 'success') => ({
  scope: { result: scopeResult, outputs: { jobs: JSON.stringify(jobs) } },
  ...results,
});

test('passes when every needed job succeeded and the rest were skipped', () => {
  const verdict = judge(needs(['guards', 'story', 'billing'], {
    guards: { result: 'success' },
    story: { result: 'success' },
    billing: { result: 'success' },
    'goldline-mobile': { result: 'skipped' },
  }));
  assert.equal(verdict.ok, true);
});

test('a needed job that was skipped fails the gate', () => {
  const verdict = judge(needs(['guards', 'billing'], { guards: { result: 'success' }, billing: { result: 'skipped' } }));
  assert.equal(verdict.ok, false);
  assert.deepEqual(verdict.rows.filter(row => !row.ok).map(row => row.job), ['billing']);
});

test('any failure or cancellation fails the gate, needed or not', () => {
  for (const result of ['failure', 'cancelled']) {
    const verdict = judge(needs(['guards'], { guards: { result: 'success' }, 'goldline-mobile': { result } }));
    assert.equal(verdict.ok, false, result);
  }
});

test('a scope job that failed, was cancelled or said nothing fails the gate', () => {
  assert.equal(judge(needs(['guards'], { guards: { result: 'success' } }, 'failure')).ok, false);
  assert.equal(judge(needs(['guards'], { guards: { result: 'success' } }, 'cancelled')).ok, false);
  assert.equal(judge({ guards: { result: 'success' } }).ok, false);
  assert.equal(judge({ scope: { result: 'success', outputs: {} }, guards: { result: 'success' } }).ok, false);
  assert.equal(judge({ scope: { result: 'success', outputs: { jobs: '[]' } } }).ok, false);
});

test('a needed job merge-gate does not wait for fails the gate', () => {
  const verdict = judge(needs(['guards', 'new-suite'], { guards: { result: 'success' } }));
  assert.equal(verdict.ok, false);
  assert.match(verdict.problem, /new-suite/);
});
