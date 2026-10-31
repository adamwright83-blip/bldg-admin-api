import { goldlineChapterFictionStateSchema, type GoldlineChapterFictionState } from '@shared/goldlineChapterState';
import { saveSchema, START, type ChapterSave } from './model';
/**
 * This device's copy of the chapter, scoped to the signed-in account (and its
 * session tenant when the session carries one). The server keys chapter rows by
 * tenant and operator; an unscoped key let one account's local progress on a
 * shared browser be pushed up as another account's. The old unscoped key
 * (`goldline:chapter-dev:<chapterId>:v1`) is deliberately never read here.
 */
export function chapterStorageKey(chapterId:string,owner:{openId:string;tenantId?:string|null}):string {
  return `goldline:chapter:${chapterId}:v1:${encodeURIComponent(owner.tenantId||'-')}:${encodeURIComponent(owner.openId)}`;
}
export function chapterFromServer(value:unknown):ChapterSave|null {
  const p=goldlineChapterFictionStateSchema.safeParse(value);if(!p.success)return null;
  const s=p.data;const local=saveSchema.safeParse({...s,...s.mechanism});return local.success?local.data:null;
}
/**
 * "Begin again" replays a finished chapter on this device only: a local save
 * that is not completed is never synced over a completed server record.
 */
export function chapterReplayStaysLocal(save:ChapterSave,base:GoldlineChapterFictionState|null):boolean {
  return base?.completed===true&&!save.completed;
}
/** Only the chapter's fictional fields are changed; server-supplied world facts survive saves. */
export function chapterToServer(save:ChapterSave,base:GoldlineChapterFictionState|null):GoldlineChapterFictionState {
  return {...(base??{}),chapterId:save.chapterId,version:save.version,room:save.room,
    checkpoint:{room:save.room,...START},mechanism:{heading:save.heading,gardenOpen:save.gardenOpen,latchOpen:save.latchOpen},
    // The choice recorded with a completed chapter is never cleared or replaced by a replay.
    cleared:save.cleared,completed:save.completed,choice:base?.completed?base.choice??save.choice:save.choice,secretSeen:save.secretSeen,
    restored:base?.restored??false,prepared:base?.prepared??{armedAt:null,resolvedEventId:null},realOutcome:base?.realOutcome??null};
}
