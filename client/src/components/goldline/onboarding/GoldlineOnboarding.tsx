import { CustomerImport } from "./CustomerImport";
import { DesignPartnerWorld } from "./DesignPartnerWorld";
import { startBrowserSpeechTranscript, type BrowserSpeechSession } from "@/lib/browserSpeechRecognition";
import { useEffect, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { ONBOARDING_QUESTIONS, type GoldlineOnboardingSession } from "@shared/goldlineOnboarding";
import "./onboarding.css";
const art = "/assets/goldline/procedural-world-v1/";

export function OnboardingInterview({ session, busy, error, onAnswer, onInterpret, children }: {
 session: GoldlineOnboardingSession; busy: boolean; error?: string;
 onAnswer: (answer: string) => Promise<unknown>; onInterpret: () => Promise<unknown>; children?: React.ReactNode;
}) {
 const [answer, setAnswer] = useState("");
 const question = session.currentQuestion;
 const speech = useRef<BrowserSpeechSession | null>(null);
 const [listening,setListening] = useState(false);
 const canSpeak = typeof window !== "undefined" && ("SpeechRecognition" in window || "webkitSpeechRecognition" in window);
 useEffect(()=>()=>speech.current?.abort(),[]);
 const stopSpeech=()=>{speech.current?.abort();speech.current=null;setListening(false);};
 return <main className="gl-onboarding" data-presentation="game_projection">
  <div className="gl-onboarding-sky" aria-hidden="true" />
  <div className="gl-onboarding-preview" aria-hidden="true">
   {Array.from({length: Math.max(1, Math.min(5, question + 1))}, (_,i) => <img key={i} src={art+"02-territory-island-generic.png"} alt="" style={{left:`${12+(i%3)*29}%`,top:`${5+Math.floor(i/3)*26}%`, animationDelay:`${i*100}ms`}} />)}
  </div>
  <header><span>GOLDLINE</span><span>YOUR FIRST CHAPTER</span></header>
  <section className="gl-interview-scene" key={question}>
   <p className="gl-eyebrow">{question < 5 ? `SCENE ${question+1} OF 5` : "THE WORLD IS TAKING SHAPE"}</p>
   <h1>{question < 5 ? ONBOARDING_QUESTIONS[question] : "Reality provides the objectives. You bring the adventure."}</h1>
   {question < 5 ? <form onSubmit={async e=>{e.preventDefault(); stopSpeech(); try { await onAnswer(answer); setAnswer(""); } catch { /* parent displays mutation error */ }}}>
    <label className="sr-only" htmlFor="goldline-answer">{ONBOARDING_QUESTIONS[question]}</label>
    <textarea id="goldline-answer" autoFocus required maxLength={2000} value={answer} onChange={e=>setAnswer(e.target.value)} placeholder="Tell it in your own words…" disabled={busy} />
    <div className="gl-answer-footer"><button type="button" disabled={!canSpeak || busy} aria-pressed={listening} onClick={()=>{if(listening)stopSpeech();else{speech.current=startBrowserSpeechTranscript({initialText:answer,onTranscript:setAnswer});setListening(Boolean(speech.current));}}}>{listening ? "STOP MIC" : canSpeak ? "USE MIC" : "TYPE YOUR STORY"}</button><span>Your words are saved after each scene.</span><button type="submit" disabled={busy || !answer.trim()}>{busy ? "SAVING…" : "CONTINUE →"}</button></div>
   </form> : session.interpretation ? children : <button className="gl-primary" disabled={busy} onClick={()=>void onInterpret().catch(()=>{})}>{busy ? "READING YOUR STORY…" : "ASSEMBLE MY WORLD"}</button>}
   {error && <p role="alert" className="gl-onboarding-error">{error}</p>}
   {question > 1 && question < 5 && <p className="gl-story-echo">{question === 4 ? `The resistance takes shape: “${session.answers[3]}”` : `Your world begins in “${session.answers[1]}”`}</p>}
  </section>
  <footer>Fantasy scenery · Your real customers and outcomes only appear from evidence.</footer>
 </main>;
}
export default function GoldlineOnboarding() {
 const state = trpc.system.goldlineOnboarding.state.useQuery();
 const utils = trpc.useUtils();
 const start = trpc.system.goldlineOnboarding.start.useMutation({onSuccess:()=>utils.system.goldlineOnboarding.state.invalidate()});
 const save = trpc.system.goldlineOnboarding.answer.useMutation({onSuccess:()=>utils.system.goldlineOnboarding.state.invalidate()});
 const reveal = trpc.system.goldlineOnboarding.reveal.useMutation({onSuccess:()=>utils.system.goldlineOnboarding.state.invalidate()});
 const interpret = trpc.system.goldlineOnboarding.interpret.useMutation({onSuccess:()=>utils.system.goldlineOnboarding.state.invalidate()});
 const session = state.data?.session;
 if (state.isLoading) return <main className="gl-onboarding"><p className="gl-entry">Opening your world…</p></main>;
 if (state.error) return <main className="gl-onboarding"><div className="gl-entry"><p role="alert">{state.error.message}</p><a href="/">Return to sign in</a></div></main>;
 if (state.data?.compatibility === "LEGACY_EXISTING_WORLD") return <main className="gl-onboarding"><div className="gl-entry"><h1>Your world is waiting.</h1><a href="/growth/lantern-city">RETURN TO LANTERN CITY</a></div></main>;
 if (!session) return <main className="gl-onboarding"><div className="gl-onboarding-sky"/><div className="gl-entry"><p>GOLDLINE</p><h1>Your work.<br/>An extraordinary world.</h1><p>Five questions. One useful mission. Your first chapter starts here.</p><button disabled={start.isPending} onClick={()=>start.mutate()}>BEGIN YOUR STORY</button>{start.error && <p role="alert">{start.error.message}</p>}</div></main>;
 if(session.status === "COMPLETE" && session.world && session.mission) return <DesignPartnerWorld session={session}/>;
 return <OnboardingInterview session={session} busy={save.isPending || interpret.isPending} error={save.error?.message || interpret.error?.message} onAnswer={answer=>save.mutateAsync({question:session.currentQuestion,answer,version:session.version})} onInterpret={()=>interpret.mutateAsync()}><CustomerImport busy={reveal.isPending} onContinue={()=>reveal.mutate()} />{reveal.error&&<p role="alert">{reveal.error.message}</p>}</OnboardingInterview>;
}
