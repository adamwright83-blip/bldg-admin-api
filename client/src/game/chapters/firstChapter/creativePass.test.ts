import { describe,it,expect } from 'vitest';
import { createChapter,stepChapter } from './model';
import { chapterFromServer,chapterToServer } from './persistence';
import { chapterLine,interactionHint } from './presentation';
const idle={x:0,y:0};
describe('creative pass gameplay and host continuity',()=>{
 it('a committed dispatch hits solid scenery and creates an opening without reaching the player',()=>{
  let s=createChapter();s.player={x:600,y:320};s.enemy={...s.enemy!,x:345,y:320,stage:'charge',target:{...s.player}};
  s=stepChapter(s,40,idle);expect(s.enemy?.stage).toBe('recover');expect(s.effect).toBe('stagger');expect(s.hp).toBe(3);
 });
 it('the final encounter tightens its tell only after its second phase',()=>{
  let s=createChapter({...createChapter().save,room:'gallery'});s.enemy!.hp=3;s.enemy!.clock=770;
  const fast=stepChapter(s,20,idle);expect(fast.enemy?.stage).toBe('charge');
  s.enemy!.hp=5;expect(stepChapter(s,20,idle).enemy?.stage).toBe('tell');
 });
 it('server checkpoints map their nested mechanism back to the playable local save',()=>{
  const local={...createChapter().save,room:'garden' as const,heading:'latch' as const,gardenOpen:true,latchOpen:true,choice:'break' as const};
  expect(chapterFromServer(chapterToServer(local,null))).toEqual(local);
 });
 it('ordinary play never resets server-provided event or real-outcome fields',()=>{
  const local=createChapter().save,server=chapterToServer(local,null);
  server.prepared={armedAt:'2026-09-09T00:00:00Z',resolvedEventId:'verified-event'};server.realOutcome='lost';server.restored=true;
  const saved=chapterToServer({...local,gardenOpen:true},server);
  expect(saved.prepared).toEqual(server.prepared);expect(saved.realOutcome).toBe('lost');expect(saved.restored).toBe(true);expect(saved.completed).toBe(false);
 });
 it('invalid persisted states do not overwrite a playable local checkpoint',()=>{expect(chapterFromServer({room:'gallery',completed:true})).toBeNull();});
 it('contextual use prompts follow the physical interaction radius',()=>{
  const s=createChapter({...createChapter().save,room:'garden'});expect(interactionHint(s)).toBeNull();s.player={x:220,y:380};expect(interactionHint(s)).toBe('Release launcher');
 });
 it('remembered decisions affect authored reactions rather than commercial facts',()=>{
  const s=createChapter({...createChapter().save,room:'garden',choice:'break'});expect(chapterLine(s).key).toBe('break');expect(s.save.completed).toBe(false);
 });
});
