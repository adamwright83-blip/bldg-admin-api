import { useEffect, useRef, useState } from 'react';
import { Application } from 'pixi.js';
import { getAudioManager, type AudioCueId } from '../../audio/AudioManager';
import { arcadeFeedback, combatHurtFeedback } from '../../audio/haptics';
import { createChapter, restoreChapter, retryChapter, stepChapter, ROOM_NAMES, REDIRECTOR, type Input, type ChapterState } from './model';
import { ChapterScene, EMPTY_WORLD, type WorldPresentation } from './ChapterScene';
import { chapterLine, interactionHint } from './presentation';
import './firstChapter.css';

export type FirstChapterProps={world?:WorldPresentation;onPrepare?:()=>void;onEcho?:()=>void;syncStatus?:string};
export default function FirstChapter({world=EMPTY_WORLD,onPrepare,onEcho,syncStatus='Saved on this device'}:FirstChapterProps) {
  const mount=useRef<HTMLDivElement>(null);
  const sim=useRef<ChapterState>(createChapter());
  const input=useRef<Input>({x:0,y:0});
  const keys=useRef(new Set<string>());
  const [view,setView]=useState(()=>createChapter());
  const [city,setCity]=useState(false);const cityRef=useRef(false);
  const [dismissed,setDismissed]=useState('');
  const worldRef=useRef(world);worldRef.current=world;
  const [ready,setReady]=useState(false);
  const [error,setError]=useState<string|null>(null);
  const [playing,setPlaying]=useState(false);
  const [endingSeen,setEndingSeen]=useState(false);
  const playingRef=useRef(false);
  const storageKey='goldline:chapter-dev:the-last-valet:v1';
  const resume=()=>{sim.current.paused=false;playingRef.current=true;setPlaying(true);getAudioManager().play('ui_tap');};
  const pause=()=>{input.current={x:0,y:0};keys.current.clear();sim.current.paused=true;playingRef.current=false;setPlaying(false);};
  useEffect(()=>{
    let stopped=false,initialized=false,elapsed=0,lastCue=0,lastSave='';let observer:ResizeObserver|undefined;
    const app=new Application();const scene=new ChapterScene();
    try{sim.current=restoreChapter(localStorage.getItem(storageKey));}catch{sim.current=createChapter();}
    sim.current.paused=true;
    const paint=(ms=16)=>scene.paint(sim.current,ms,app.screen.width,app.screen.height,cityRef.current,worldRef.current);
    const init=async()=>{
      await app.init({width:960,height:640,backgroundAlpha:0,antialias:true,resolution:Math.min(devicePixelRatio||1,2),autoDensity:true});
      initialized=true;if(stopped){app.destroy(true,{children:true});return;}
      app.canvas.setAttribute('aria-label','Chapter playfield');
      mount.current?.appendChild(app.canvas);app.stage.addChild(scene.root);
      const resize=()=>{const el=mount.current;if(el){app.renderer.resize(Math.max(320,Math.min(960,640*el.clientWidth/el.clientHeight)),640);}};
      resize();observer=new ResizeObserver(resize);if(mount.current)observer.observe(mount.current);
      scene.onTap(point=>{
        if(!cityRef.current||!playingRef.current)return;
        const s=sim.current,redirect=REDIRECTOR[s.save.room];
        // The overhead view manipulates the very same fictional detent.
        if(redirect&&Math.hypot(point.x-redirect.x,point.y-redirect.y)<65){
          const headings=s.save.room==='garden'?['bridge','latch'] as const:['confrontation'] as const;
          const i=headings.findIndex(h=>h===s.save.heading);
          sim.current={...s,save:{...s.save,heading:headings[(i+1)%headings.length]},cue:s.cue+1,effect:'redirect'};
        }
      });
      await scene.load();if(stopped)return;
      paint();setReady(true);setView({...sim.current});
      app.ticker.add(t=>{
        if(stopped)return;
        if(playingRef.current&&!document.hidden&&!cityRef.current){
          const k=keys.current;
          const cmd={...input.current,x:input.current.x+(k.has('d')||k.has('arrowright')?1:0)-(k.has('a')||k.has('arrowleft')?1:0),
            y:input.current.y+(k.has('s')||k.has('arrowdown')?1:0)-(k.has('w')||k.has('arrowup')?1:0)};
          sim.current=stepChapter(sim.current,t.deltaMS,cmd);
          input.current.dodge=false;input.current.attack=false;input.current.interact=false;
          if(sim.current.cue!==lastCue){
            lastCue=sim.current.cue;
            const cues:Partial<Record<ChapterState['effect'],AudioCueId>>={hit:'strike_hit',hurt:'player_hurt',guard:'shield_clang',dodge:'dodge',open:'gate_unlock',win:'hostile_down',launch:'tower_launch',redirect:'mechanism_align',stagger:'weak_point_hit',saved:'barrier_release',secret:'scout_discovery'};
            const cue=cues[sim.current.effect];if(cue)getAudioManager().play(cue);
            if(sim.current.effect==='hurt')combatHurtFeedback();else if(sim.current.effect==='hit')arcadeFeedback();
          }
        }
        paint(t.deltaMS);elapsed+=t.deltaMS;
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
    return()=>{stopped=true;observer?.disconnect();window.removeEventListener('keydown',down);window.removeEventListener('keyup',up);window.removeEventListener('blur',pause);document.removeEventListener('visibilitychange',hidden);if(initialized)app.destroy(true,{children:true});};
  },[]);
  const line=chapterLine(view),hint=interactionHint(view);
  const toggleScale=()=>{cityRef.current=!cityRef.current;setCity(cityRef.current);input.current={x:0,y:0};keys.current.clear();};
  return <main className="fc" data-room={view.save.room} data-hp={view.hp} data-x={Math.round(view.player.x)} data-y={Math.round(view.player.y)} data-enemy-stage={view.enemy?.stage??'none'} data-enemy-hp={view.enemy?.hp??0} data-enemy-x={Math.round(view.enemy?.x??0)} data-enemy-y={Math.round(view.enemy?.y??0)} data-completed={view.save.completed}>
    <header><span>G O L D L I N E</span><div><button className="fc-scale" onClick={toggleScale}>{city?'Step inside':'City scale'}</button><a href="/">Leave</a></div></header>
    <h1>{ROOM_NAMES[view.save.room]}</h1>
    <div className="fc-hud"><span aria-label={`${view.hp} health remaining`}>{'●'.repeat(view.hp)}{'○'.repeat(3-view.hp)}</span><span>{view.save.completed?'The building is still.':view.enemy&&view.enemy.stage!=='down'?(view.enemy.stage==='recover'?'Opening — strike!':'Watch the dispatch line'):view.save.room==='garden'&&!view.save.gardenOpen?'Follow the brass track':'Reach the upper gate'}</span><button onClick={pause}>Pause</button></div>
    <div className="fc-playfield"><div ref={mount} className="fc-stage" />
    {playing&&line.key!==dismissed?<button className="fc-dialogue" onClick={()=>setDismissed(line.key)} aria-label="Dismiss dialogue"><small>{line.speaker}</small><span>{line.text}</span><i>×</i></button>:null}
    {playing&&hint&&!city?<span className="fc-interaction">{hint} <kbd>E</kbd></span>:null}
    {city?<div className="fc-city-note">The same machinery. A different distance.<br/><small>Touch a turntable to set its detent.</small>{onPrepare?<button onClick={onPrepare} disabled={world.armed}>{world.armed?'Receiver prepared':'Prepare receiver'}</button>:null}{onEcho?<button onClick={onEcho}>Trace the familiar motion</button>:null}</div>:null}
    </div>
    {error?<p role="alert">{error}</p>:null}
    {!playing&&!view.lost?<div className="fc-message"><p>{ready?'The machinery is already moving.':'Preparing the passage…'}</p><button disabled={!ready} onClick={resume}>{ready?'Enter / Resume':'Preparing…'}</button></div>:null}
    {view.lost?<div className="fc-message"><b>Try a different approach.</b><button onClick={()=>{sim.current=retryChapter(sim.current);setView({...sim.current});resume();}}>Retry checkpoint</button></div>:null}
    {view.save.completed&&!endingSeen?<div className="fc-message"><b>Departure stopped.</b><p>{view.save.choice==='break'?'A rough new silence settles over the court.':'For once, everything stays where it belongs.'}</p><button onClick={()=>{setEndingSeen(true);resume();}}>Continue exploring</button><button onClick={()=>{sim.current=createChapter();setView({...sim.current});setEndingSeen(false);resume();}}>Begin again</button></div>:null}
    <div className="fc-controls" aria-label="Chapter controls"><div className="fc-pad">{[['↑',0,-1],['←',-1,0],['↓',0,1],['→',1,0]].map(([label,x,y])=><button key={label} aria-label={`Move ${label}`} disabled={!playing||view.lost||city} onPointerDown={e=>{e.currentTarget.setPointerCapture(e.pointerId);input.current.x=Number(x);input.current.y=Number(y);}} onPointerUp={()=>{input.current.x=0;input.current.y=0;}} onPointerCancel={()=>{input.current.x=0;input.current.y=0;}}>{label}</button>)}</div>
    <div>{(['dodge','attack','interact'] as const).map(action=><button key={action} disabled={!playing||view.lost||city} onPointerDown={()=>{input.current[action]=true;}} onClick={e=>{if(e.detail===0)input.current[action]=true;}}>{action==='interact'?(hint??'Use'):action==='attack'?'Strike':'Dodge'}</button>)}</div></div>
    <p className="fc-help">WASD / arrows · Space dodge · J strike · E use · Esc pause. Stationary play only. <span>{syncStatus}</span></p>
  </main>;
}
