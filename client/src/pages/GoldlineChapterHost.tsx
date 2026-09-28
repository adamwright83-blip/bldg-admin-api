import { useEffect, useRef, useState } from 'react';
import { trpc } from '@/lib/trpc';
import FirstChapter from '@/game/chapters/firstChapter/FirstChapter';
import { CHAPTER_ID, saveSchema } from '@/game/chapters/firstChapter/model';
import { chapterFromServer, chapterToServer } from '@/game/chapters/firstChapter/persistence';
import { goldlineChapterFictionStateSchema, type GoldlineChapterFictionState } from '@shared/goldlineChapterState';
const STORAGE_KEY=`goldline:chapter-dev:${CHAPTER_ID}:v1`;
const BINDING={chapterId:CHAPTER_ID,buildingId:'century_park_east' as const};
/** Server revision that unsaved local play was built on; set when the host unmounts before its last push lands. */
const UNSYNCED_KEY=`${STORAGE_KEY}:unsynced-from`;
/** Authenticated host; all business evidence remains behind the existing server boundaries. */
export default function GoldlineChapterHost(){
  const revision=useRef(0),base=useRef<GoldlineChapterFictionState|null>(null),lastPushed=useRef(''),busy=useRef(false);
  const [seeded,setSeeded]=useState(false),[generation,setGeneration]=useState(0),[status,setStatus]=useState('Saved on this device');
  const [echoOpen,setEchoOpen]=useState(false),[echoEnabled,setEchoEnabled]=useState(false);
  const state=trpc.system.goldlineChapterState.get.useQuery({chapterId:CHAPTER_ID},{retry:false,refetchOnWindowFocus:false});
  const save=trpc.system.goldlineChapterState.save.useMutation();
  const binding=trpc.system.goldlineChapterEventBinding.get.useQuery(BINDING,{retry:false,enabled:seeded&&!state.error,refetchOnWindowFocus:false});
  const arm=trpc.system.goldlineChapterEventBinding.arm.useMutation();
  const reconcile=trpc.system.goldlineChapterEventBinding.reconcile.useMutation();
  const echo=trpc.system.goldlineEchoFollowUp.brief.useQuery(undefined,{enabled:echoEnabled,retry:false,refetchOnWindowFocus:echoEnabled});
  const saveRef=useRef(save);saveRef.current=save;
  const utils=trpc.useUtils();
  function adopt(value:unknown,rev:number){
    const parsed=goldlineChapterFictionStateSchema.safeParse(value),local=chapterFromServer(value);
    if(!parsed.success||!local)return false;
    base.current=parsed.data;revision.current=rev;
    try{const raw=JSON.stringify(local);localStorage.setItem(STORAGE_KEY,raw);lastPushed.current=raw;}catch{return false;}
    setGeneration(g=>g+1);return true;
  }
  /** Local play that never reached the server, built on exactly this server revision, wins over it. */
  function keepUnsyncedLocal(rev:number){
    try{
      const from=localStorage.getItem(UNSYNCED_KEY),raw=localStorage.getItem(STORAGE_KEY);
      return from!==null&&Number(from)===rev&&!!raw&&saveSchema.safeParse(JSON.parse(raw)).success;
    }catch{return false;}
  }
  useEffect(()=>{
    if(state.isLoading)return;
    const serverBase=state.data?goldlineChapterFictionStateSchema.safeParse(state.data.state):null;
    if(state.data&&serverBase?.success&&keepUnsyncedLocal(state.data.revision)){
      base.current=serverBase.data;revision.current=state.data.revision;lastPushed.current='';
      setStatus('Recent progress kept · syncing');
    }
    else if(state.data&&adopt(state.data.state,state.data.revision))setStatus('Checkpoint synchronized');
    else if(state.error)setStatus('Local save · cross-device sync unavailable');
    setSeeded(true);
  },[state.isLoading,state.data,state.error]);
  /** Push local play to the server. `final` runs on unmount: it still records success so nothing is re-adopted over it. */
  async function pushLocal(final:boolean,disposed:{current:boolean}){
    if(busy.current&&!final)return;
    let raw:string|null;try{raw=localStorage.getItem(STORAGE_KEY);}catch{return;}
    if(!raw||raw===lastPushed.current)return;
    let local;try{local=saveSchema.safeParse(JSON.parse(raw));}catch{return;}if(!local.success)return;
    busy.current=true;
    try{
      const next=chapterToServer(local.data,base.current);
      const result=await saveRef.current.mutateAsync({chapterId:CHAPTER_ID,expectedRevision:revision.current,state:next,requestId:crypto.randomUUID()});
      if(result.ok){
        revision.current=result.revision;base.current=next;lastPushed.current=raw;
        try{localStorage.removeItem(UNSYNCED_KEY);}catch{/* storage unavailable */}
        // keep the cached checkpoint current so the next mount adopts this save, not the one before it
        utils.system.goldlineChapterState.get.setData({chapterId:CHAPTER_ID},old=>old?{...old,state:next,revision:result.revision}:old);
        if(!disposed.current)setStatus('Checkpoint synchronized');
      }
      else if(result.latest&&!disposed.current){adopt(result.latest.state,result.latest.revision);setStatus('Newer checkpoint restored · resume when ready');}
    }catch{if(!disposed.current)setStatus('Local save · sync will retry');}finally{busy.current=false;}
  }
  useEffect(()=>{
    if(!seeded||state.error)return;
    const disposed={current:false};
    const interval=setInterval(()=>{void pushLocal(false,disposed);},4000);
    return()=>{
      disposed.current=true;clearInterval(interval);
      // leaving the chapter: let any save in flight land, remember what the unsaved play is built on, then flush it
      void (async()=>{
        while(busy.current)await new Promise(r=>setTimeout(r,50));
        try{
          const raw=localStorage.getItem(STORAGE_KEY);
          if(raw&&raw!==lastPushed.current)localStorage.setItem(UNSYNCED_KEY,String(revision.current));
        }catch{/* storage unavailable */}
        await pushLocal(true,disposed);
      })();
    };
  },[seeded,state.error]);
  const reconciled=useRef(false);
  useEffect(()=>{
    if(!binding.data?.armedAt||binding.data.resolvedEventId||reconciled.current)return;
    reconciled.current=true;
    void reconcile.mutateAsync(BINDING).then(()=>binding.refetch()).catch(()=>setStatus('Local save · world reconciliation unavailable'));
  },[binding.data]);
  const prepare=async()=>{try{await arm.mutateAsync(BINDING);await binding.refetch();}catch{setStatus('Receiver unavailable · local chapter remains playable');}};
  const trace=()=>{setEchoEnabled(true);setEchoOpen(true);};
  return <div className="fc-host">
    {!seeded?<p>Preparing the passage…</p>:<FirstChapter key={generation} syncStatus={status}
      world={{armed:!!binding.data?.armedAt,resolved:!!binding.data?.resolvedEventId,outcome:base.current?.realOutcome??null,echo:echoEnabled&&!!echo.data?.available}}
      onPrepare={prepare} onEcho={trace}/>}
    {echoOpen?<section className="fc-echo" aria-label="Recorded follow-up" tabIndex={-1}>
      <h2>The familiar motion</h2>
      {echo.isLoading?<p>Retrieving the recorded follow-up…</p>:echo.data?.available?<>
        <p>{echo.data.note||'No note recorded.'}</p><dl><dt>Recorded due date</dt><dd>{echo.data.dueAt}</dd><dt>Assigned to</dt><dd>{echo.data.assignedTo??'Not recorded'}</dd></dl>
        {echo.data.missingInfo.length?<p>{echo.data.missingInfo.join(' · ')}</p>:null}
        <small>Source: recorded follow-up {echo.data.followUpId}. Prepared for your review; nothing sent.</small>
      </>:<p>{echo.error?'The recorded follow-up is unavailable.':'No eligible recorded follow-up.'}</p>}
      <button onClick={()=>setEchoOpen(false)}>Return to the machinery</button>
    </section>:null}
  </div>;
}
