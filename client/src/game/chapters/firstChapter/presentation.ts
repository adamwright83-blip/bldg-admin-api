import { BALCONY, EXIT, LAUNCHER, MANUAL_LATCH, REDIRECTOR, SWITCH, distance, exitReady, type ChapterState } from './model';
export function interactionHint(s:ChapterState):string|null {
  const room=s.save.room,p=s.player;
  if(room==='arrival'&&s.save.completed&&distance(p,BALCONY)<80)return 'Look through';
  const r=REDIRECTOR[room],l=LAUNCHER[room];
  if(r&&distance(p,r)<70)return 'Turn redirector';
  if(l&&distance(p,l)<70)return s.weight?'Resetting…':'Release launcher';
  if(room==='garden'&&!s.save.latchOpen&&distance(p,MANUAL_LATCH)<70)return 'Preserve apparatus';
  if(room==='garden'&&distance(p,SWITCH)<75)return 'Move bridge';
  if(distance(p,EXIT)<85&&exitReady(s))return s.save.room==='gallery'?'Stop departure':'Go through';
  return null;
}
export function chapterLine(s:ChapterState):{speaker:string;text:string;key:string} {
  const room=s.save.room;
  if(s.save.secretSeen)return {speaker:'Inez',text:'I wondered whether you noticed. Stay a minute.',key:'secret'};
  if(s.save.completed)return {speaker:'Inez',text:'Same place tomorrow? Preferably still attached to the building.',key:'ending'};
  if(s.effect==='saved')return {speaker:'Perrin',text:'I said I would hold it. Go.',key:'saved'};
  if(room==='arrival')return {speaker:'Inez',text:'If you are here for the view, it is leaving.',key:'arrival'};
  if(room==='garden') {
    if(s.save.choice==='preserve')return {speaker:'Inez',text:'All right. We save the machine too.',key:'preserve'};
    if(s.save.choice==='break')return {speaker:'Perrin',text:'That was the original latch. I will remember.',key:'break'};
    if(s.weight)return {speaker:'Inez',text:'I have the detent. You take the opening.',key:'weight'};
    if(distance(s.player,MANUAL_LATCH)<150)return {speaker:'Perrin',text:'The handle still works. Please leave something worth returning to.',key:'choice'};
    return {speaker:'Inez',text:'A spring sends it. The turntable decides where. I can hold that.',key:'garden'};
  }
  if(s.enemy?.stage==='down')return {speaker:'Perrin',text:s.save.choice==='break'?'It will never sound quite the same.':'There. Still in one piece.',key:'down'};
  if(s.enemy&&s.enemy.hp<=3)return {speaker:'Bellwether',text:'We appear to have fallen behind schedule.',key:'phase-two'};
  return {speaker:'Bellwether',text:'Your departure was arranged. Your consent was not required.',key:'gallery'};
}
