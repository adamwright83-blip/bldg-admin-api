import { describe,it,expect } from 'vitest';
import { createChapter,stepChapter,restoreChapter,retryChapter,EXIT,SWITCH,SHORTCUT_CRATE,MANUAL_LATCH,LAUNCHER,REDIRECTOR,BALCONY,ROOMS, type ChapterState } from './model';
const idle={x:0,y:0};
function tick(s:ChapterState,n:number,input=idle){for(let i=0;i<n;i++)s=stepChapter(s,20,input);return s;}
function fireWeight(s:ChapterState,heading:'bridge'|'latch'|'confrontation'){
  s.player={...REDIRECTOR[s.save.room]!};
  while(s.save.heading!==heading)s=stepChapter(s,20,{...idle,interact:true});
  s.player={...LAUNCHER[s.save.room]!};
  s=stepChapter(s,20,{...idle,interact:true});
  for(let i=0;i<200&&s.weight;i++)s=stepChapter(s,20,idle);
  return s;
}
describe('first chapter fictional spine',()=>{
 it('moves with existing acceleration and bounds huge suspended frames',()=>{
  const s=createChapter();const moved=stepChapter(s,10000,{x:1,y:0});
  expect(moved.player.x-s.player.x).toBeLessThan(2);expect(s.player.x).toBe(150);
  expect(tick(s,300,{x:-1,y:0}).player.x).toBe(76);
 });
 it('stops at scenery and never tunnels during dodge',()=>{
  let s=createChapter();s.player={x:330,y:310};s.facing={x:1,y:0};
  s=stepChapter(s,40,{x:1,y:0,dodge:true});s=tick(s,10,{x:1,y:0});expect(s.player.x).toBeLessThanOrEqual(354);
 });
 it('normalizes diagonal input and pauses without advancing',()=>{
  const a=tick(createChapter(),20,{x:1,y:0});const b=tick(createChapter(),20,{x:1,y:1});
  expect(Math.hypot(b.velocity.x,b.velocity.y)).toBeLessThanOrEqual(190.01);
  expect(a.player.x).toBeGreaterThan(b.player.x);
  const paused={...a,paused:true};expect(stepChapter(paused,40,{...idle,attack:true})).toBe(paused);
 });
 it('requires reach and recovery, produces guard and hit stop',()=>{
  let s=createChapter();s.player={x:625,y:245};s.facing={x:1,y:0};
  let hit=stepChapter(s,20,{...idle,attack:true});expect(hit.effect).toBe('guard');expect(hit.enemy?.hp).toBe(2);expect(hit.freeze).toBe(70);
  s.enemy!.stage='recover';hit=stepChapter(s,20,{...idle,attack:true});expect(hit.enemy?.hp).toBe(1);expect(hit.effect).toBe('hit');
  expect(stepChapter(hit,20,{...idle,attack:true}).enemy?.hp).toBe(1);
 });
 it('does not hit behind the heroine or from across the room',()=>{
  let s=createChapter();s.enemy!.stage='recover';expect(stepChapter(s,20,{...idle,attack:true}).enemy?.hp).toBe(2);
  s.player={x:625,y:245};s.facing={x:-1,y:0};expect(stepChapter(s,20,{...idle,attack:true}).enemy?.hp).toBe(2);
 });
 it('dodge prevents charge damage and cannot restart during cooldown',()=>{
  let s=createChapter();s.enemy = {...s.enemy!,x:155,y:470,stage:'charge',target:{x:150,y:470}};
  const hurt=stepChapter(s,20,idle);expect(hurt.hp).toBe(2);expect(hurt.freeze).toBe(90);
  const safe=stepChapter(s,20,{...idle,dodge:true});expect(safe.hp).toBe(3);
  expect(stepChapter(safe,20,{...idle,dodge:true}).dodgeCooldown).toBe(830);
 });
 it('death retries a safe checkpoint and resets combat',()=>{
  let s=createChapter();s.hp=1;s.enemy = {...s.enemy!,x:155,y:470,stage:'charge',target:{...s.player}};
  s=stepChapter(s,20,idle);expect(s.lost).toBe(true);expect(stepChapter(s,20,idle)).toBe(s);
  const retry=retryChapter(s);expect(retry.hp).toBe(3);expect(retry.lost).toBe(false);expect(retry.enemy?.hp).toBe(2);
 });
 it('requires actual proximity to manipulate or exit',()=>{
  let s=createChapter();expect(stepChapter(s,20,{...idle,interact:true}).save.room).toBe('arrival');
  s.save.room='garden';s.enemy=null;expect(stepChapter(s,20,{...idle,interact:true}).save.gardenOpen).toBe(false);
  s.player={...SWITCH};expect(stepChapter(s,20,{...idle,interact:true}).save.gardenOpen).toBe(true);
 });
 it('completes all three rooms without any business input',()=>{
  let s=createChapter();
  for(const room of ROOMS){
   expect(s.save.room).toBe(room);
   // Fight via the public input transition; position adjacent during recovery.
   while(s.enemy&&s.enemy.hp>0){s.enemy.stage='recover';s.enemy.clock=0;s.player={x:s.enemy.x-70,y:s.enemy.y};s.facing={x:1,y:0};s.freeze=0;s.attackCooldown=0;
    s=stepChapter(s,20,{...idle,attack:true});}
   if(room==='garden'){s.player={...SWITCH};s=stepChapter(s,20,{...idle,interact:true});}
   s.freeze=0;s.player={...EXIT};s=stepChapter(s,20,{...idle,interact:true});
  }
  expect(s.save.completed).toBe(true);expect(s.save.cleared).toEqual(['arrival','gallery']);
 });
 it('launch sends the weight toward the redirector at a fixed, bounded speed',()=>{
  let s=createChapter({...createChapter().save,room:'garden'});
  s.player={...LAUNCHER.garden!};
  s=stepChapter(s,20,{...idle,interact:true});
  expect(s.weight).not.toBeNull();
  expect(s.weight!.phase).toBe('toRedirector');
  const start={...s.weight!};
  s=stepChapter(s,20,idle);
  const moved=Math.hypot(s.weight!.x-start.x,s.weight!.y-start.y);
  expect(moved).toBeGreaterThan(0);expect(moved).toBeLessThan(20);
 });
 it('redirect sends the same weight to a chosen heading — traversal use',()=>{
  let s=createChapter({...createChapter().save,room:'garden'});
  expect(s.save.gardenOpen).toBe(false);
  s=fireWeight(s,'bridge');
  expect(s.save.gardenOpen).toBe(true);expect(s.weight).toBeNull();
 });
 it('redirect to the latch opens the garden shortcut — puzzle use',()=>{
  let s=createChapter({...createChapter().save,room:'garden'});
  expect(s.save.latchOpen).toBe(false);
  s.player={x:SHORTCUT_CRATE.x-40,y:SHORTCUT_CRATE.y+20};
  s=tick(s,10,{x:1,y:0});
  expect(s.player.x).toBeLessThanOrEqual(SHORTCUT_CRATE.x);
  s=fireWeight(s,'latch');
  expect(s.save.latchOpen).toBe(true);
  s.player={x:SHORTCUT_CRATE.x-20,y:SHORTCUT_CRATE.y+20};
  s=tick(s,40,{x:1,y:0});
  expect(s.player.x).toBeGreaterThan(SHORTCUT_CRATE.x);
 });
 it('redirect to confrontation staggers the boss — combat use, and direct strike remains viable',()=>{
  let s=createChapter({...createChapter().save,room:'gallery'});
  s.enemy!.stage='charge';s.enemy!.clock=0;
  s=fireWeight(s,'confrontation');
  expect(s.enemy!.stage).toBe('recover');
  s.player={x:s.enemy!.x-70,y:s.enemy!.y};s.facing={x:1,y:0};
  s=stepChapter(s,20,{...idle,attack:true});
  expect(s.enemy!.hp).toBe(4);
  let direct=createChapter({...createChapter().save,room:'gallery'});
  direct.enemy!.stage='recover';direct.player={x:direct.enemy!.x-70,y:direct.enemy!.y};direct.facing={x:1,y:0};
  direct=stepChapter(direct,20,{...idle,attack:true});
  expect(direct.enemy!.hp).toBe(4);
 });
 it('mechanism state and heading selection persist through checkpoint retry',()=>{
  let s=createChapter({...createChapter().save,room:'garden'});
  s=fireWeight(s,'latch');
  const retry=retryChapter(s);
  expect(retry.save.latchOpen).toBe(true);expect(retry.weight).toBeNull();
 });
 it('Perrin\'s manual route opens the shortcut, remembers "preserve", and grants a saving grace',()=>{
  let s=createChapter({...createChapter().save,room:'garden'});
  expect(s.grace).toBe(false);
  s.player={...MANUAL_LATCH};
  s=stepChapter(s,20,{...idle,interact:true});
  expect(s.save.latchOpen).toBe(true);expect(s.save.choice).toBe('preserve');
  expect(retryChapter(s).grace).toBe(true);
 });
 it('Inez\'s redirect route remembers "break" instead, and buys a longer stagger window',()=>{
  let base=createChapter({...createChapter().save,room:'gallery',cleared:['arrival'],choice:null});
  base.enemy!.stage='charge';base.enemy!.clock=0;
  const withoutChoice=fireWeight({...base},'confrontation');
  let broke=createChapter({...createChapter().save,room:'garden'});
  broke=fireWeight(broke,'latch');
  expect(broke.save.choice).toBe('break');
  let gallery=createChapter({...broke.save,room:'gallery',cleared:['arrival']});
  gallery.enemy!.stage='charge';gallery.enemy!.clock=0;
  gallery=fireWeight(gallery,'confrontation');
  expect(gallery.enemy!.clock).toBeLessThan(withoutChoice.enemy!.clock);
 });
 it('a saving grace cancels one otherwise-fatal hit, once',()=>{
  let s=createChapter({...createChapter().save,choice:'preserve'});
  expect(s.grace).toBe(true);
  s.hp=1;s.enemy={...s.enemy!,x:155,y:470,stage:'charge',target:{...s.player}};
  s=stepChapter(s,20,idle);
  expect(s.lost).toBe(false);expect(s.hp).toBe(1);expect(s.grace).toBe(false);
  s=tick(s,10,idle);
  s.hp=1;s.hurt=0;s.freeze=0;s.enemy={...s.enemy!,x:155,y:470,stage:'charge',target:{...s.player}};
  s=stepChapter(s,20,idle);
  expect(s.lost).toBe(true);
 });
 it('completing the chapter returns the heroine to the court, per the locked ending beat',()=>{
  let s=createChapter({...createChapter().save,room:'gallery',cleared:['arrival','garden']});
  s.enemy!.stage='recover';s.player={x:s.enemy!.x-70,y:s.enemy!.y};s.facing={x:1,y:0};
  while(s.enemy&&s.enemy.hp>0){
    s=stepChapter(s,20,{...idle,attack:true});s.freeze=0;s.attackCooldown=0;
    if(s.enemy&&s.enemy.hp>0){s.enemy.stage='recover';s.enemy.clock=0;}
  }
  s.freeze=0;s.player={...EXIT};
  s=stepChapter(s,20,{...idle,interact:true});
  expect(s.save.completed).toBe(true);expect(s.save.room).toBe('arrival');
 });
 it('the return secret is unreachable before completion and reachable — once — after',()=>{
  let s=createChapter();
  s.player={x:BALCONY.x,y:BALCONY.y+60};
  s=tick(s,40,{x:0,y:-1});
  expect(s.player.y).toBeGreaterThan(BALCONY.y+10);
  let done=createChapter({...createChapter().save,completed:true});
  done.player={...BALCONY};
  done=stepChapter(done,20,{...idle,interact:true});
  expect(done.save.secretSeen).toBe(true);expect(done.effect).toBe('secret');
  const cueBefore=done.cue;
  const again=stepChapter(done,20,{...idle,interact:true});
  expect(again.cue).toBe(cueBefore);
 });
 it('restores only validated fiction; malformed versions reset safely',()=>{
  const s=createChapter();s.save.gardenOpen=true;
  const restored=restoreChapter(JSON.stringify({...s.save,revenue:999999,customer:'fake'}));
  expect(restored.save.gardenOpen).toBe(true);expect(restored.save).not.toHaveProperty('revenue');
  expect(restoreChapter('{oops').save.room).toBe('arrival');
  expect(restoreChapter(JSON.stringify({...s.save,version:99})).save.gardenOpen).toBe(false);
 });
});
