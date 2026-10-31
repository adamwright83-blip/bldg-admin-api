import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CHAPTER_ID, createChapter } from './model';
import { chapterReplayStaysLocal, chapterStorageKey, chapterToServer } from './persistence';

const finished = () => ({ ...createChapter().save, room: 'arrival' as const, cleared: ['arrival', 'garden', 'gallery'] as Array<'arrival' | 'garden' | 'gallery'>, completed: true, choice: 'preserve' as const });

describe('first chapter persistence boundary', () => {
  it('scopes the device save slot to the signed-in account and its session tenant', () => {
    const a = chapterStorageKey(CHAPTER_ID, { openId: 'op-a', tenantId: 't1' });
    const b = chapterStorageKey(CHAPTER_ID, { openId: 'op-b', tenantId: 't1' });
    const otherTenant = chapterStorageKey(CHAPTER_ID, { openId: 'op-a', tenantId: 't2' });
    expect(a).not.toBe(b);
    expect(a).not.toBe(otherTenant);
    expect(chapterStorageKey(CHAPTER_ID, { openId: 'op-a' })).not.toBe(a);
    // The old unscoped slot is never one of the scoped keys, so it is never read for an account.
    for (const key of [a, b, otherTenant]) expect(key).not.toBe(`goldline:chapter-dev:${CHAPTER_ID}:v1`);
    // Separators inside ids cannot collide two accounts into one slot.
    expect(chapterStorageKey(CHAPTER_ID, { openId: 'b', tenantId: 'a:x' })).not.toBe(chapterStorageKey(CHAPTER_ID, { openId: 'x:b', tenantId: 'a' }));
  });

  it('keeps a "Begin again" replay of a finished chapter on this device', () => {
    const record = chapterToServer(finished(), null);
    expect(chapterReplayStaysLocal(createChapter().save, record)).toBe(true);
    expect(chapterReplayStaysLocal(finished(), record)).toBe(false);
    expect(chapterReplayStaysLocal(createChapter().save, null)).toBe(false);
    expect(chapterReplayStaysLocal(createChapter().save, chapterToServer(createChapter().save, null))).toBe(false);
  });

  it('the authenticated host syncs only the account-scoped slot and never pushes a replay', () => {
    const host = readFileSync(resolve(import.meta.dirname, '../../../pages/GoldlineChapterHost.tsx'), 'utf8');
    expect(host).not.toContain('goldline:chapter-dev:');
    expect(host).toContain('chapterStorageKey(CHAPTER_ID,{openId:user.openId');
    expect(host).toContain('storageKey={STORAGE_KEY}');
    const guard = host.indexOf('if(chapterReplayStaysLocal(local.data,base.current))return;');
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(host.indexOf('saveRef.current.mutateAsync('));
  });

  it('never replaces the choice recorded with a completed chapter', () => {
    const record = chapterToServer(finished(), null);
    expect(chapterToServer({ ...finished(), choice: 'break' }, record).choice).toBe('preserve');
    expect(chapterToServer({ ...finished(), choice: 'break' }, { ...record, choice: null }).choice).toBe('break');
    const open = chapterToServer({ ...createChapter().save, choice: 'preserve' }, null);
    expect(chapterToServer({ ...createChapter().save, room: 'garden', choice: 'break' }, open).choice).toBe('break');
  });
});
