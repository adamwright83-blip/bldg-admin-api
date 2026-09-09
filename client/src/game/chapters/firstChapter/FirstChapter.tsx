import { useEffect, useRef, useState } from 'react';
import { Application, Assets, Graphics, Sprite, Texture } from 'pixi.js';
import { facingForVelocity } from '../../../pages/goldline/overworld/movement';
import { getAudioManager, type AudioCueId } from '../../audio/AudioManager';
import { arcadeFeedback, combatHurtFeedback } from '../../audio/haptics';
import { createChapter, restoreChapter, retryChapter, stepChapter, ROOM_NAMES, WALLS, EXIT, SWITCH, SHORTCUT_CRATE, LAUNCHER, REDIRECTOR, exitReady, type Input, type ChapterState } from './model';
import './firstChapter.css';

/** Slice 1 development entry. No API calls; host integration and server persistence are Slice 3. */
export default function FirstChapter() {
  const mount=useRef<HTMLDivElement>(null);
  const sim=useRef<ChapterState>(createChapter());
  const input=useRef<Input>({x:0,y:0});
  const keys=useRef(new Set<string>());
  const [view,setView]=useState(()=>createChapter());
  const [ready,setReady]=useState(false);
  const [error,setError]=useState<string|null>(null);
  const [playing,setPlaying]=useState(false);
  const playingRef=useRef(false);
  const storageKey='goldline:chapter-dev:the-last-valet:v1';
  const resume=()=>{sim.current.paused=false;playingRef.current=true;setPlaying(true);getAudioManager().play('ui_tap');};
  const pause=()=>{input.current={x:0,y:0};keys.current.clear();sim.current.paused=true;playingRef.current=false;setPlaying(false);};
  useEffect(()=>{
    let stopped=false,initialized=false,elapsed=0,lastCue=0,lastSave='';
    const app=new Application();const art=new Graphics();const hero=new Sprite();
    const textures:Record<string,Texture>={};
    try{sim.current=restoreChapter(localStorage.getItem(storageKey));}catch{sim.current=createChapter();}
    sim.current.paused=true;
    const paint=()=>{
      const s=sim.current;art.clear();
      art.rect(0,0,960,640).fill(0xd5ebe8);
      art.poly([60,100,900,100,950,560,10,560]).fill(0xe8dcc2);
      art.rect(60,100,840,450).stroke({color:0xc1a478,width:5});
      // Ground grid and raised obstacles are temporary registration geometry.
      for(let y=150;y<550;y+=50)art.moveTo(60,y).lineTo(900,y).stroke({color:0xd4c4a6,width:1});
      for(const r of WALLS[s.save.room]){
        art.rect(r.x+7,r.y+12,r.w,r.h).fill({color:0x263f38,alpha:.18});
        art.rect(r.x,r.y-24,r.w,r.h).fill(0x729d89);
        art.rect(r.x,r.y+r.h-24,r.w,24).fill(0x496e61);
      }
      art.circle(EXIT.x,EXIT.y,40).fill({color:exitReady(s)?0x239e91:0x9a8e79,alpha:.5});
      art.moveTo(EXIT.x-12,EXIT.y).lineTo(EXIT.x+12,EXIT.y).lineTo(EXIT.x+3,EXIT.y-10).stroke({color:0xffffff,width:4});
      if(s.save.room==='garden'){
        art.circle(SWITCH.x,SWITCH.y,35).fill(0xc5a359);
        art.moveTo(SWITCH.x,SWITCH.y).lineTo(SWITCH.x+(s.save.gardenOpen?22:-22),SWITCH.y-30).stroke({color:0x214d4a,width:8});
        art.moveTo(600,200).lineTo(830,200).stroke({color:s.save.gardenOpen?0x238d82:0x9d6c55,width:18});
        if(!s.save.latchOpen){const r=SHORTCUT_CRATE;art.rect(r.x,r.y,r.w,r.h).fill(0x8a6a45);art.rect(r.x,r.y,r.w,r.h).stroke({color:0x4a3a26,width:3});}
      }
      const launcher=LAUNCHER[s.save.room];const redirector=REDIRECTOR[s.save.room];
      if(launcher){art.circle(launcher.x,launcher.y,26).fill(s.weight?0x8f9e6b:0xb8a15c);art.circle(launcher.x,launcher.y,26).stroke({color:0x3e3520,width:3});}
      if(redirector){
        const active=s.save.heading!=null;
        art.circle(redirector.x,redirector.y,30).fill(active?0x4bb2a4:0x9c9077);
        art.circle(redirector.x,redirector.y,30).stroke({color:0x2b3f3a,width:3});
        if(s.save.heading)art.circle(redirector.x,redirector.y,8).fill(0xfaf3df);
      }
      if(s.weight){art.circle(s.weight.x,s.weight.y,12).fill(0x5a4632);art.circle(s.weight.x,s.weight.y,12).stroke({color:0xfaf3df,width:2});}
      const e=s.enemy;
      if(e&&e.stage!=='down'){
        if(e.stage==='tell'||e.stage==='charge'){
          art.moveTo(e.x,e.y).lineTo(e.target.x,e.target.y).stroke({color:0xc35d40,width:e.stage==='charge'?7:3,alpha:.7});
          art.circle(e.target.x,e.target.y,28).stroke({color:0xc35d40,width:2});
        }
        art.ellipse(e.x,e.y+6,26,12).fill({color:0x273c39,alpha:.22});
        art.roundRect(e.x-23,e.y-54,46,54,8).fill(e.stage==='recover'?0x58aaa0:0xb57747);
        art.circle(e.x,e.y-60,14).fill(0xf6e2b0);
        for(let i=0;i<e.hp;i++)art.circle(e.x-20+i*10,e.y-86,3).fill(0x6b3530);
      }
      art.ellipse(s.player.x,s.player.y+3,18,8).fill({color:0x172e2a,alpha:.25});
      if(s.dodge>0)art.circle(s.player.x,s.player.y-15,25).stroke({color:0x4bd4c1,width:3,alpha:.7});
      if(s.attack>0)art.circle(s.player.x+s.facing.x*65,s.player.y+s.facing.y*65-16,26).stroke({color:0xfaffdb,width:7,alpha:s.attack/150});
      hero.position.set(s.player.x,s.player.y);
      hero.alpha=s.hurt>0&&Math.floor(s.hurt/80)%2===0?.4:1;
      const facing=facingForVelocity(s.velocity,'front');if(textures[facing])hero.texture=textures[facing];
      // Front rail overlays the stage but not the HUD; final art belongs to Slice 9.
    };
    const init=async()=>{
      await app.init({width:960,height:640,backgroundAlpha:0,antialias:true,resolution:Math.min(devicePixelRatio||1,2),autoDensity:true});
      initialized=true;if(stopped){app.destroy(true,{children:true});return;}
      app.canvas.setAttribute('aria-label','Chapter playfield');
      mount.current?.appendChild(app.canvas);app.stage.addChild(art);app.stage.addChild(hero);
      hero.anchor.set(.5,1);hero.width=64;hero.height=94;
      for(const facing of ['front','back','left','right']) {
        const texture=await Assets.load<Texture>(`/assets/goldline/characters/trailblazer/directional/idle-${facing}.webp`);
        if(stopped)return;textures[facing]=texture;
      }
      hero.texture=textures.front;hero.width=64;hero.height=94;paint();setReady(true);setView({...sim.current});
      app.ticker.add(t=>{
        if(stopped)return;
        if(playingRef.current&&!document.hidden){
          const k=keys.current;
          const cmd={...input.current,x:input.current.x+(k.has('d')||k.has('arrowright')?1:0)-(k.has('a')||k.has('arrowleft')?1:0),
            y:input.current.y+(k.has('s')||k.has('arrowdown')?1:0)-(k.has('w')||k.has('arrowup')?1:0)};
          sim.current=stepChapter(sim.current,t.deltaMS,cmd);
          input.current.dodge=false;input.current.attack=false;input.current.interact=false;
          if(sim.current.cue!==lastCue){
            lastCue=sim.current.cue;
            const cues:Partial<Record<ChapterState['effect'],AudioCueId>>={hit:'strike_hit',hurt:'player_hurt',guard:'shield_clang',dodge:'dodge',open:'gate_unlock',win:'hostile_down',launch:'tower_launch',redirect:'mechanism_align',stagger:'weak_point_hit'};
            const cue=cues[sim.current.effect];if(cue)getAudioManager().play(cue);
            if(sim.current.effect==='hurt')combatHurtFeedback();else if(sim.current.effect==='hit')arcadeFeedback();
          }
        }
        paint();elapsed+=t.deltaMS;
        if(elapsed>100){elapsed=0;setView({...sim.current});const saved=JSON.stringify(sim.current.save);
          if(saved!==lastSave){try{localStorage.setItem(storageKey,saved);lastSave=saved;}catch{/* playable without local storage */}}
        }
      });
    };
    void init().catch(e=>{if(!stopped)setError(e instanceof Error?e.message:'Renderer unavailable');});
    const down=(e:KeyboardEvent)=>{
      if(!playingRef.current||e.target instanceof HTMLInputElement||e.target instanceof HTMLTextAreaElement)return;
      const key=e.key.toLowerCase();if([' ','arrowup','arrowdown','arrowleft','arrowright'].includes(key))e.preventDefault();
      keys.current.add(key);if(e.repeat)return;
      if(key===' ')input.current.dodge=true;if(key==='j')input.current.attack=true;if(key==='e')input.current.interact=true;
      if(key==='escape')pause();
    };
    const up=(e:KeyboardEvent)=>{keys.current.delete(e.key.toLowerCase());};
    const hidden=()=>{if(document.hidden)pause();};
    window.addEventListener('keydown',down);window.addEventListener('keyup',up);window.addEventListener('blur',pause);document.addEventListener('visibilitychange',hidden);
    return()=>{stopped=true;window.removeEventListener('keydown',down);window.removeEventListener('keyup',up);window.removeEventListener('blur',pause);document.removeEventListener('visibilitychange',hidden);if(initialized)app.destroy(true,{children:true});};
  },[]);
  return <main className="fc" data-room={view.save.room} data-hp={view.hp} data-x={Math.round(view.player.x)} data-y={Math.round(view.player.y)} data-enemy-stage={view.enemy?.stage??'none'} data-enemy-hp={view.enemy?.hp??0} data-enemy-x={Math.round(view.enemy?.x??0)} data-enemy-y={Math.round(view.enemy?.y??0)} data-completed={view.save.completed}>
    <header><span>GOLDLINE · DEVELOPMENT BUILD</span><a href="/">Exit</a></header>
    <h1>{ROOM_NAMES[view.save.room]}</h1>
    <div className="fc-hud"><span aria-label={`${view.hp} health remaining`}>{'●'.repeat(view.hp)}{'○'.repeat(3-view.hp)}</span><span>{view.enemy&&view.enemy.stage!=='down'?(view.enemy.stage==='recover'?'Opening — strike!':'Watch the dispatch line'):view.save.room==='garden'&&!view.save.gardenOpen?'Find the brass lever':'Reach the upper gate'}</span><button onClick={pause}>Pause</button></div>
    <div ref={mount} className="fc-stage" />
    {error?<p role="alert">{error}</p>:null}
    {!playing&&!view.lost&&!view.save.completed?<div className="fc-message"><p>Temporary geometry · fictional play only</p><button disabled={!ready} onClick={resume}>{ready?'Enter / Resume':'Preparing…'}</button></div>:null}
    {view.lost?<div className="fc-message"><b>Try a different approach.</b><button onClick={()=>{sim.current=retryChapter(sim.current);setView({...sim.current});resume();}}>Retry checkpoint</button></div>:null}
    {view.save.completed?<div className="fc-message"><b>Departure stopped.</b><p>The fictional chapter spine is complete. No business state changed.</p><button onClick={()=>{sim.current=createChapter();setView({...sim.current});resume();}}>Replay graybox</button></div>:null}
    <div className="fc-controls"><div className="fc-pad">{[['↑',0,-1],['←',-1,0],['↓',0,1],['→',1,0]].map(([label,x,y])=><button key={label} aria-label={`Move ${label}`} onPointerDown={e=>{e.currentTarget.setPointerCapture(e.pointerId);input.current.x=Number(x);input.current.y=Number(y);}} onPointerUp={()=>{input.current.x=0;input.current.y=0;}} onPointerCancel={()=>{input.current.x=0;input.current.y=0;}}>{label}</button>)}</div>
    <div>{(['dodge','attack','interact'] as const).map(action=><button key={action} disabled={!playing||view.lost||view.save.completed} onPointerDown={()=>{input.current[action]=true;}} onKeyDown={e=>{if(e.key==='Enter')input.current[action]=true;}}>{action}</button>)}</div></div>
    <p className="fc-help">WASD / arrows · Space dodge · J strike · E use · Esc pause. Stationary play only.</p>
  </main>;
}
