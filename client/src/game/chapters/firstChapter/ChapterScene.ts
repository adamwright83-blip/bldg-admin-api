import { Assets, Container, Graphics, Rectangle, Sprite, Texture, Text } from 'pixi.js';
import { WALLS, EXIT, SWITCH, SHORTCUT_CRATE, MANUAL_LATCH, LAUNCHER, REDIRECTOR, BALCONY, HEADING_TARGETS, distance, exitReady, type ChapterState, type Room, type Point } from './model';

const BASE='/assets/goldline/chapters/the-last-valet';
export type WorldPresentation={resolved:boolean;armed:boolean;outcome:'follow_up'|'won'|'lost'|null;echo:boolean};
export const EMPTY_WORLD:WorldPresentation={resolved:false,armed:false,outcome:null,echo:false};
const rooms:Record<Room,string>={arrival:'arrival-court',garden:'turntable-garden',gallery:'departure-gallery'};
/** Every sprite is a separate, depth-sorted piece. Collision stays in model.ts. */
export class ChapterScene {
  readonly root=new Container();
  private back=new Sprite(); private floor=new Graphics(); private ground=new Graphics();
  private actors=new Container(); private overlay=new Graphics(); private atmosphere=new Graphics();
  private sprites=new Map<string,Sprite>(); private textures=new Map<string,Texture>();
  private labels=new Map<string,Text>(); private fxAge=1000; private lastCue=-1; private lastRoom:Room|null=null;
  private age=0;private transition=0;private cameraX=0; private reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
  private pointerHandler:((point:Point)=>void)|null=null;
  constructor(){
    this.actors.sortableChildren=true;
    this.root.addChild(this.back,this.floor,this.ground,this.actors,this.overlay,this.atmosphere);
    this.root.eventMode='static';this.root.hitArea=new Rectangle(0,0,960,640);
    this.root.on('pointertap',event=>{const p=this.root.toLocal(event.global);this.pointerHandler?.({x:p.x,y:p.y});});
  }
  onTap(fn:(point:Point)=>void){this.pointerHandler=fn;}
  async load(){
    const assets:Record<string,string>={scenery:'props/scenery-atlas.png',machinery:'mechanisms/machinery-atlas.png',props:'mechanisms/props-atlas.png',fx:'fx/impact-atlas.png',inez:'characters/inez-atlas.png',perrin:'characters/perrin-atlas.png',bellwether:'characters/bellwether-atlas.png',actions:'characters/heroine-actions.png'};
    for(const [room,name] of Object.entries(rooms))assets[room]=`backgrounds/${name}.png`;
    for(const dir of ['front','back','left','right'])assets[`hero-${dir}`]=`/assets/goldline/characters/trailblazer/directional/idle-${dir}.webp`;
    await Promise.all(Object.entries(assets).map(async([key,path])=>{
      try{const t=await Assets.load<Texture>(path.startsWith('/')?path:`${BASE}/${path}`);this.textures.set(key,t);}catch{/* local graybox remains playable while art loads */}
    }));
  }
  private sprite(id:string,asset:string,frame:number|null,x:number,y:number,w:number,h:number,z=y,alpha=1,columns=3,rows=2){
    const base=this.textures.get(asset);if(!base)return null;
    let texture=base;
    if(frame!==null){const key=`${asset}:${frame}`;let t=this.textures.get(key);if(!t){const cw=base.width/columns,ch=base.height/rows;t=new Texture({source:base.source,frame:new Rectangle(frame%columns*cw,Math.floor(frame/columns)*ch,cw,ch)});this.textures.set(key,t);}texture=t;}
    let s=this.sprites.get(id);if(!s){s=new Sprite();s.anchor.set(.5,1);this.sprites.set(id,s);this.actors.addChild(s);}
    s.texture=texture;s.blendMode=asset.startsWith('hero-')?'normal':'multiply';s.position.set(x,y);s.width=w;s.height=h;s.zIndex=z;s.alpha=alpha;s.visible=true;s.rotation=0;s.tint=0xffffff;return s;
  }
  private label(id:string,text:string,x:number,y:number,color=0x33564c,size=13){
    let l=this.labels.get(id);if(!l){l=new Text({text,style:{fontFamily:'Georgia',fontSize:size,fill:color,fontWeight:'600',dropShadow:{color:0xfff8df,alpha:.8,blur:3,distance:0}}});l.anchor.set(.5,1);this.labels.set(id,l);this.actors.addChild(l);}l.text=text;l.position.set(x,y);l.zIndex=900;l.visible=true;
  }
  private shadow(x:number,y:number,w=25){this.ground.ellipse(x+7,y+3,w,w*.35).fill({color:0x173c35,alpha:.22});}
  paint(s:ChapterState,ms:number,width:number,height:number,city:boolean,world:WorldPresentation){
    if(!s.paused&&!s.lost)this.age+=ms;
    if(s.cue!==this.lastCue){this.lastCue=s.cue;this.fxAge=0;}else this.fxAge+=ms;
    if(this.lastRoom!==s.save.room){this.lastRoom=s.save.room;this.transition=650;}
    this.transition=Math.max(0,this.transition-ms);
    for(const sprite of Array.from(this.sprites.values()))sprite.visible=false;for(const label of Array.from(this.labels.values()))label.visible=false;
    const room=s.save.room,g=this.ground,o=this.overlay;g.clear();o.clear();this.floor.clear();this.atmosphere.clear();
    const bg=this.textures.get(room);if(bg){this.back.texture=bg;this.back.width=960;this.back.height=640;this.back.visible=true;}else {this.back.visible=false;this.floor.rect(0,0,960,640).fill(0xa6d2cc);}
    // The painted empty terrace supplies material and perspective. Independent
    // islands, gates, rails, machines and actors supply all interaction geometry.
    if(!bg){this.floor.rect(60,100,840,450).fill(0xefe1bd);}
    g.rect(63,103,834,444).stroke({color:0xb69862,width:2,alpha:.18});
    // Raised island art follows the exact collision footprint and sorts at its front lip.
    for(const [i,r] of Array.from(WALLS[room].entries())){
      this.shadow(r.x+r.w/2,r.y+r.h,r.w*.6);
      const a=this.sprite(`island-${i}`,'scenery',1,r.x+r.w/2,r.y+r.h+9,r.w+34,r.h+86,r.y+r.h);
      if(!a){
        // No standalone scenery atlas was generated; a warm stone bevel reads as raised
        // machinery housing against every room's painted palette, unlike a flat color block.
        g.rect(r.x-6,r.y+r.h-6,r.w+12,20).fill({color:0x8c6f43,alpha:.35});
        g.rect(r.x,r.y,r.w,r.h).fill(0xd9c9a3);
        g.rect(r.x,r.y,r.w,r.h).stroke({color:0xa9895a,width:3});
        g.rect(r.x+8,r.y+8,r.w-16,r.h-16).stroke({color:0xc1a478,width:1,alpha:.6});
      }
      g.rect(r.x,r.y+r.h-5,r.w,6).fill({color:0xa17e45,alpha:.75});
    }
    // The same gear shape and orientation remains legible at either scale.
    const wheel=this.sprite('departure-wheel','scenery',5,755,126,160,155,50);
    if(wheel&&!s.save.completed&&!this.reduced){wheel.anchor.set(.5,.5);wheel.y=64;wheel.rotation=Math.sin(this.age/4000)*.06;}
    this.sprite('gate','scenery',3,EXIT.x,EXIT.y+25,138,180,EXIT.y+10);
    g.ellipse(EXIT.x,EXIT.y+10,33,12).fill({color:exitReady(s)?0xb9e6b4:0x7c8063,alpha:.65});
    if(exitReady(s)){g.moveTo(EXIT.x-8,EXIT.y+4).lineTo(EXIT.x,EXIT.y-6).lineTo(EXIT.x+8,EXIT.y+4).stroke({color:0xfaffdc,width:3});}
    if(room==='arrival'){
      this.sprite('balcony','props',s.save.completed?4:3,BALCONY.x,BALCONY.y+37,145,156,BALCONY.y+20);
      if(s.save.completed){g.ellipse(BALCONY.x,BALCONY.y+8,42,20).fill({color:0xf8cb6d,alpha:.24});}
    }
    if(room==='garden'){
      // A raised brass bridge and the opened/broken latch have visible aftermath.
      g.moveTo(620,202).lineTo(841,202).stroke({color:0x694e2c,width:22});
      g.moveTo(620,197).lineTo(s.save.gardenOpen?841:710,197).stroke({color:0xe5c16e,width:15});
      this.sprite('lever','props',s.save.gardenOpen?2:1,SWITCH.x,SWITCH.y+15,67,87);
      if(!s.save.latchOpen){
        const crate=this.sprite('crate','scenery',1,SHORTCUT_CRATE.x+35,SHORTCUT_CRATE.y+47,87,88,SHORTCUT_CRATE.y+40);
        if(!crate){const r=SHORTCUT_CRATE;g.rect(r.x,r.y,r.w,r.h).fill(0x8a6a45);g.rect(r.x,r.y,r.w,r.h).stroke({color:0x4a3a26,width:3});}
      }
      else if(s.save.choice==='break') {g.poly([565,475,580,449,600,479,620,452]).stroke({color:0xa47a35,width:7});}
      this.sprite('manual','props',s.save.latchOpen?2:1,MANUAL_LATCH.x,MANUAL_LATCH.y+14,64,80);
    }
    const launch=LAUNCHER[room],redirect=REDIRECTOR[room];
    if(launch&&redirect){
      g.moveTo(launch.x,launch.y).lineTo(redirect.x,redirect.y).stroke({color:0x927443,width:9,alpha:.4});
      g.moveTo(launch.x,launch.y).lineTo(redirect.x,redirect.y).stroke({color:0xffefb2,width:2,alpha:.8});
      const target=room==='gallery'?s.enemy??EXIT:HEADING_TARGETS[room]?.[s.save.heading??'bridge']??EXIT;
      g.moveTo(redirect.x,redirect.y).lineTo(target.x,target.y).stroke({color:0x359987,width:3,alpha:.42});
      const phase=s.weight?.phase==='toRedirector'?2:world.armed?1:0;
      this.shadow(launch.x,launch.y,38);this.shadow(redirect.x,redirect.y,36);
      const machine=this.sprite('launcher','machinery',phase,launch.x,launch.y+23,123,116);
      if(machine&&phase===2&&!this.reduced)machine.x-=Math.sin(Math.min(this.fxAge,200)/200*Math.PI)*7;
      this.sprite('redirector','machinery',s.effect==='redirect'&&this.fxAge<240?5:s.save.heading==='latch'?4:3,redirect.x,redirect.y+28,118,111);
      const angle=Math.atan2(target.y-redirect.y,target.x-redirect.x);
      g.moveTo(redirect.x,redirect.y).lineTo(redirect.x+Math.cos(angle)*45,redirect.y+Math.sin(angle)*45).stroke({color:0xf7e5a6,width:5});
      if(city||distance(s.player,launch)<100)this.label('launch-label',s.weight?'RESETTING':'LAUNCH',launch.x,launch.y-54);
      if(city||distance(s.player,redirect)<100)this.label('redirect-label','REDIRECT',redirect.x,redirect.y-47);
      if(world.resolved){
        g.moveTo(launch.x-30,launch.y+22).lineTo(launch.x-30,160).lineTo(800,160).stroke({color:0xf0c56d,width:5,alpha:.6});
        this.sprite('receiver','machinery',1,launch.x-65,170,85,90,170);
      }
    }
    if(s.weight){this.shadow(s.weight.x,s.weight.y,15);this.sprite('weight','props',0,s.weight.x,s.weight.y+9,49,50);g.circle(s.weight.x,s.weight.y-10,16).stroke({color:0xf6d77d,width:2,alpha:.6});}
    const inez=room==='arrival'?{x:252,y:404}:room==='garden'?{x:535,y:400}:{x:542,y:499};
    const walk=!city&&!s.paused&&Math.hypot(s.velocity.x,s.velocity.y)>20;
    this.shadow(inez.x,inez.y,20);
    this.sprite('inez','inez',s.weight?3:walk?1+Math.floor(this.age/280)%2:0,inez.x,inez.y+(this.reduced?0:Math.sin(this.age/650)*1.2),88,122);
    if(room!=='arrival'||s.save.completed){const p=room==='garden'?{x:713,y:465}:{x:800,y:415};this.shadow(p.x,p.y,20);this.sprite('perrin','perrin',s.save.choice==='break'?4:5,p.x,p.y,86,118);}
    const e=s.enemy;
    if(e){
      if(e.stage==='tell'||e.stage==='charge'){
        g.moveTo(e.x,e.y).lineTo(e.target.x,e.target.y).stroke({color:0x992e27,width:e.stage==='charge'?16:9,alpha:.18});
        g.moveTo(e.x,e.y).lineTo(e.target.x,e.target.y).stroke({color:0xb4462c,width:e.stage==='charge'?4:2,alpha:.85});
        g.circle(e.target.x,e.target.y,29).stroke({color:0xb4462c,width:2});
      }
      this.shadow(e.x,e.y,room==='gallery'?29:22);
      const frame=e.stage==='down'?5:e.stage==='charge'?3:e.stage==='recover'?4:0;
      const enemy=this.sprite('enemy',room==='gallery'?'bellwether':'props',room==='gallery'?frame:5,e.x,e.y+8,room==='gallery'?118:84,room==='gallery'?165:95,e.y,e.stage==='down'?.65:1);
      if(enemy&&e.stage==='charge'&&!this.reduced)enemy.rotation=Math.sin(this.age/75)*.06;
      if(e.stage!=='down'){
        for(let i=0;i<e.hp;i++)g.circle(e.x-((e.hp-1)*6)+i*12,e.y-(room==='gallery'?134:72),3.4).fill(0x933e2c);
        if(e.stage==='recover'){g.ellipse(e.x,e.y,33,13).stroke({color:0x65c7ab,width:3});this.label('opening','STRIKE',e.x,e.y-(room==='gallery'?143:83),0x2e7565,12);}
      }
    }
    if(world.outcome==='lost'){g.moveTo(795,160).lineTo(865,190).stroke({color:0xa9653b,width:9});g.moveTo(800,191).lineTo(860,157).stroke({color:0xa9653b,width:9});g.moveTo(815,200).lineTo(879,231).stroke({color:0xe7ce88,width:5});}
    if(world.echo){this.sprite('echo','inez',3,inez.x-64,inez.y-5,88,122,inez.y-6,.22);g.moveTo(inez.x-70,inez.y).lineTo(inez.x-100,inez.y-20).stroke({color:0x71bdb0,width:3,alpha:.5});}
    this.shadow(s.player.x,s.player.y,18);
    const dir=Math.abs(s.facing.x)>Math.abs(s.facing.y)?s.facing.x>0?'right':'left':s.facing.y>0?'front':'back';
    const action=s.dodge>0?1:s.attack>0?0:s.hurt>700?2:null;
    let hero=action===null?this.sprite('hero',`hero-${dir}`,null,s.player.x,s.player.y,58,86):this.sprite('hero-action','actions',action,s.player.x,s.player.y,99,99,s.player.y,1,3,1);
    if(!hero)hero=this.sprite('hero',`hero-${dir}`,null,s.player.x,s.player.y,58,86);
    if(hero){hero.alpha=s.hurt>0&&Math.floor(s.hurt/80)%2===0?.42:1;if(action===null&&walk&&!this.reduced){hero.y-=Math.abs(Math.sin(this.age/105))*3;hero.rotation=Math.sin(this.age/105)*.018;}}
    if(s.dodge>0)this.sprite('dodge','fx',1,s.player.x-s.facing.x*28,s.player.y+12,102,90,s.player.y+1,.6);
    if(s.attack>0)o.arc(s.player.x+s.facing.x*38,s.player.y+s.facing.y*38-18,27,-1.4,1.4).stroke({color:0xfff4c7,width:5,alpha:s.attack/150});
    if(this.fxAge<420&&s.effect!=='none'){
      const pos=['hit','guard','stagger'].includes(s.effect)?e??s.player:s.effect==='launch'?launch??s.player:s.effect==='redirect'?redirect??s.player:s.player;
      const frame=s.effect==='dodge'?1:s.effect==='launch'?2:s.effect==='redirect'?3:s.effect==='stagger'?4:['secret','win','open'].includes(s.effect)?5:0;
      this.sprite('impact','fx',frame,pos.x,pos.y+18,110+this.fxAge*.12,110+this.fxAge*.12,800,1-this.fxAge/420);
    }
    // Occlusion is deliberately confined to the near rail and island bases.
    for(let i=0;i<3;i++){const rail=this.sprite(`rail-${i}`,'scenery',2,160+i*320,632,345,125,700);
      if(!rail)o.rect(160+i*320-172,632-30,345,60).fill({color:0x1d332e,alpha:.16});}
    if(!this.reduced)for(let i=0;i<10;i++){const x=(i*117+this.age*.008)%960,y=60+(i*47)%470+Math.sin(this.age/1800+i)*10;this.atmosphere.circle(x,y,1.4).fill({color:0xffe7a8,alpha:.35});}
    if(this.transition>0)this.atmosphere.rect(0,0,960,640).fill({color:0xfff4d4,alpha:this.transition/650*.8});
    const scale=city?Math.min(width/960,height/640):height/640;
    const visibleWidth=width/scale;
    const targetX=city?0:Math.max(0,Math.min(960-visibleWidth,s.player.x-visibleWidth*.5));
    this.cameraX+= (targetX-this.cameraX)*(this.reduced?1:Math.min(1,ms/130));
    this.root.scale.set(scale);this.root.x=city?(width-960*scale)/2:-this.cameraX*scale;this.root.y=city?(height-640*scale)/2:0;
  }
}
