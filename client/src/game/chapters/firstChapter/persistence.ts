import { goldlineChapterFictionStateSchema, type GoldlineChapterFictionState } from '@shared/goldlineChapterState';
import { saveSchema, START, type ChapterSave } from './model';
export function chapterFromServer(value:unknown):ChapterSave|null {
  const p=goldlineChapterFictionStateSchema.safeParse(value);if(!p.success)return null;
  const s=p.data;const local=saveSchema.safeParse({...s,...s.mechanism});return local.success?local.data:null;
}
/** Only the chapter's fictional fields are changed; server-supplied world facts survive saves. */
export function chapterToServer(save:ChapterSave,base:GoldlineChapterFictionState|null):GoldlineChapterFictionState {
  return {...(base??{}),chapterId:save.chapterId,version:save.version,room:save.room,
    checkpoint:{room:save.room,...START},mechanism:{heading:save.heading,gardenOpen:save.gardenOpen,latchOpen:save.latchOpen},
    cleared:save.cleared,completed:save.completed,choice:save.choice,secretSeen:save.secretSeen,
    restored:base?.restored??false,prepared:base?.prepared??{armedAt:null,resolvedEventId:null},realOutcome:base?.realOutcome??null};
}
