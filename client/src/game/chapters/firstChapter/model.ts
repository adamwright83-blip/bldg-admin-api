/** Fiction-only chapter simulation. No business record or writer enters this module. */
import { z } from 'zod';
import { remapAnalogInput, stepVelocity } from '../../../pages/goldline/overworld/movement';

export const CHAPTER_ID = 'the-last-valet';
export const ROOMS = ['arrival', 'garden', 'gallery'] as const;
export type Room = typeof ROOMS[number];
export type Point = { x: number; y: number };
export type Input = Point & { dodge?: boolean; attack?: boolean; interact?: boolean };
export const ROOM_NAMES = { arrival: 'Arrival Court', garden: 'Turntable Garden', gallery: 'Departure Gallery' };
export const START = { x: 150, y: 470 };
export const EXIT = { x: 835, y: 165 };
export const SWITCH = { x: 460, y: 410 };
export const WALLS: Record<Room, Array<{x:number;y:number;w:number;h:number}>> = {
  arrival: [{x:370,y:280,w:140,h:90}],
  garden: [{x:330,y:230,w:260,h:95}],
  gallery: [{x:360,y:360,w:120,h:70}],
};
export const saveSchema = z.object({
  chapterId: z.literal(CHAPTER_ID), version: z.literal(1),
  room: z.enum(ROOMS), cleared: z.array(z.enum(ROOMS)).max(3),
  gardenOpen: z.boolean(), completed: z.boolean(),
});
export type ChapterSave = z.infer<typeof saveSchema>;
export type Enemy = Point & { hp:number; stage:'tell'|'charge'|'recover'|'down'; clock:number; target:Point };
export type ChapterState = {
  save:ChapterSave; player:Point; velocity:Point; facing:Point; hp:number;
  dodge:number; dodgeCooldown:number; attack:number; attackCooldown:number;
  hurt:number; freeze:number; enemy:Enemy|null; paused:boolean; lost:boolean;
  cue:number; effect:'none'|'hit'|'hurt'|'guard'|'dodge'|'open'|'win';
};
export function createChapter(save?: ChapterSave):ChapterState {
  const parsed = save ? saveSchema.safeParse(save) : null;
  const clean:ChapterSave = parsed?.success ? parsed.data : {
    chapterId:CHAPTER_ID,version:1,room:'arrival',cleared:[],gardenOpen:false,completed:false,
  };
  const enemy = clean.room === 'garden' || clean.cleared.includes(clean.room) ? null : {
    x:700,y:245,hp:clean.room==='gallery'?5:2,stage:'tell' as const,clock:0,target:{...START},
  };
  return {save:{...clean,cleared:[...clean.cleared]},player:{...START},velocity:{x:0,y:0},
    facing:{x:1,y:0},hp:3,dodge:0,dodgeCooldown:0,attack:0,attackCooldown:0,
    hurt:0,freeze:0,enemy,paused:false,lost:false,cue:0,effect:'none'};
}
export function restoreChapter(raw:string|null):ChapterState {
  try { return createChapter(saveSchema.parse(JSON.parse(raw??'null'))); } catch { return createChapter(); }
}
export function retryChapter(s:ChapterState) { return createChapter(s.save); }
export function distance(a:Point,b:Point) {return Math.hypot(a.x-b.x,a.y-b.y);}
function blocked(p:Point,room:Room) {
  return WALLS[room].some(r=>p.x>r.x-16&&p.x<r.x+r.w+16&&p.y>r.y-16&&p.y<r.y+r.h+16);
}
function move(p:Point,v:Point,dt:number,room:Room):Point {
  const next={...p};
  const x=Math.max(76,Math.min(884,p.x+v.x*dt));
  if(!blocked({x,y:next.y},room)) next.x=x;
  const y=Math.max(116,Math.min(534,p.y+v.y*dt));
  if(!blocked({x:next.x,y},room)) next.y=y;
  return next;
}
export function exitReady(s:ChapterState) {
  return s.save.room==='garden'?s.save.gardenOpen:!s.enemy||s.enemy.stage==='down';
}
export function stepChapter(previous:ChapterState,deltaMs:number,input:Input):ChapterState {
  if(previous.paused||previous.lost||previous.save.completed) return previous;
  const ms=Math.min(40,Math.max(0,Number.isFinite(deltaMs)?deltaMs:0));
  if(ms===0) return previous;
  const s:ChapterState={...previous,save:{...previous.save,cleared:[...previous.save.cleared]},
    player:{...previous.player},enemy:previous.enemy?{...previous.enemy,target:{...previous.enemy.target}}:null};
  if(s.freeze>0) {s.freeze=Math.max(0,s.freeze-ms);return s;}
  for(const key of ['dodge','dodgeCooldown','attack','attackCooldown','hurt'] as const) s[key]=Math.max(0,s[key]-ms);
  const analog=remapAnalogInput(Number.isFinite(input.x)?input.x:0,Number.isFinite(input.y)?input.y:0);
  if(analog.magnitude>0&&s.dodge===0) s.facing={x:analog.x/analog.magnitude,y:analog.y/analog.magnitude};
  const cue=(effect:ChapterState['effect'])=>{s.cue++;s.effect=effect;};
  if(input.dodge&&s.dodgeCooldown===0) {s.dodge=260;s.dodgeCooldown=850;cue('dodge');}
  s.velocity=s.dodge>0?{x:s.facing.x*460,y:s.facing.y*460}:stepVelocity(s.velocity,analog,ms/1000);
  s.player=move(s.player,s.velocity,ms/1000,s.save.room);
  if(input.attack&&s.attackCooldown===0&&s.dodge===0) {
    s.attack=150;s.attackCooldown=380;
    const e=s.enemy;
    const dot=e?((e.x-s.player.x)*s.facing.x+(e.y-s.player.y)*s.facing.y)/Math.max(1,distance(e,s.player)):0;
    if(e&&e.stage!=='down'&&distance(e,s.player)<100&&dot>0.2) {
      s.freeze=70;
      if(e.stage==='recover') {
        e.hp--;cue('hit');
        if(e.hp<=0){e.stage='down';s.save.cleared=Array.from(new Set([...s.save.cleared,s.save.room]));}
      } else {cue('guard');}
    }
  }
  const e=s.enemy;
  if(e&&e.stage!=='down') {
    e.clock+=ms;
    if(e.stage==='tell') {
      // Target stays visible during windup; release locks a trajectory, no homing.
      e.target={...s.player};
      if(e.clock>=1000){e.stage='charge';e.clock=0;}
    } else if(e.stage==='charge') {
      const d=distance(e,e.target);
      if(d>5){const speed=Math.min(d,340*ms/1000);e.x+=(e.target.x-e.x)/d*speed;e.y+=(e.target.y-e.y)/d*speed;}
      if(distance(e,s.player)<43&&s.dodge===0&&s.hurt===0) {
        s.hp--;s.hurt=1000;s.freeze=90;cue('hurt');if(s.hp<=0)s.lost=true;
      }
      if(e.clock>=700||d<6){e.stage='recover';e.clock=0;}
    } else if(e.clock>=1400){e.stage='tell';e.clock=0;}
  }
  if(input.interact&&!s.lost) {
    if(s.save.room==='garden'&&distance(s.player,SWITCH)<75) {
      s.save.gardenOpen=!s.save.gardenOpen;cue('open');
    } else if(distance(s.player,EXIT)<85&&exitReady(s)) {
      const index=ROOMS.indexOf(s.save.room);
      if(index===2){s.save.completed=true;cue('win');}
      else {const next=createChapter({...s.save,room:ROOMS[index+1]});next.cue=s.cue+1;next.effect='open';return next;}
    }
  }
  return s;
}
