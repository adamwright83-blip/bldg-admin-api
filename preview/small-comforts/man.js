window.ManFace=(function(){
const INK="#2b1d1a", PINK="#e3a09c";
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
function shade(h,p){const n=parseInt(h.slice(1),16);const ch=[n>>16,(n>>8)&255,n&255].map(v=>Math.max(0,Math.min(255,Math.round(p<0?v*(1+p):v+(255-v)*p))));return"#"+ch.map(x=>x.toString(16).padStart(2,"0")).join("")}
function rng(seed){let s=seed;return()=>(s=(s*9301+49297)%233280)/233280}

/* ================= characters ================= */
let CURLS_BACK="",CURLS_FRONT="";
(function(){const r=rng(5);
  for(let i=0;i<=16;i++){const a=Math.PI*(1.0+i/16),x=200+Math.cos(a)*126,y=196+Math.sin(a)*136,rad=28+r()*10;
    CURLS_BACK+=`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${rad.toFixed(1)}"/>`;}
  for(let i=0;i<=12;i++){const a=Math.PI*(1.08+.84*i/12),x=200+Math.cos(a)*104,y=170+Math.sin(a)*100,rad=24+r()*8;
    CURLS_FRONT+=`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${rad.toFixed(1)}"/>`;}
  [[150,132,22],[178,140,20],[206,134,22],[234,142,19],[258,128,20],[128,120,18]].forEach(([x,y,rad])=>CURLS_FRONT+=`<circle cx="${x}" cy="${y}" r="${rad}"/>`);
})();
const CURL_MARKS=(()=>{const r=rng(13);let s="";for(let i=0;i<26;i++){const a=Math.PI*(1.02+.96*r()),rr=90+r()*44,x=200+Math.cos(a)*rr,y=180+Math.sin(a)*rr*1.05;s+=`M${(x-7).toFixed(1)},${y.toFixed(1)} q7,-9 13,0`;}return s})();
function daisy(x,y,s,rot){let p="";for(let i=0;i<7;i++)p+=`<ellipse cx="0" cy="-9" rx="4.2" ry="9" fill="#fffdf6" stroke="#d9d0bf" stroke-width=".8" transform="rotate(${i*51.4})"/>`;
  return `<g transform="translate(${x} ${y}) rotate(${rot}) scale(${s})"><path d="M-6,8 q-14,6 -20,-2 q10,-8 20,2z" fill="#6f9a52"/>${p}<circle r="5" fill="#f1c13d"/><circle cx="-1.5" cy="-1.5" r="1.6" fill="#fff3b0"/></g>`}

const MAN={
  key:"man", label:"The man", spot:"spotM", skin:"skinM", iris:"irisM", lid:"#dda07c", lidLow:"#dba27f",
  head:"M200,70 C268,70 300,118 304,178 C310,236 326,300 312,352 C298,402 252,434 200,434 C148,434 102,402 88,352 C74,300 90,236 96,178 C100,118 132,70 200,70 Z",
  chinY:432, eyeY:226, eyeX:[160,240], eyeRx:30, eyeRy:34, lashes:false, bags:true,
  brow:{y:170, thin:8, thick:19, color:"#20140c", spanL:[114,188], spanR:[212,286]},
  nose:"bulb", noseY:300, noseR:[36,30], mouth:[200,370], lips:false, gap:true, stubble:true,
  ears:[[82,256,26,40,"#e6ad86"],[318,256,26,40,"#c98b6a"]],
  hairBack:()=>`<g filter="url(#paint)"><ellipse cx="200" cy="150" rx="146" ry="106" fill="url(#hairM)"/><g fill="url(#hairM)">${CURLS_BACK}</g></g>`,
  hairFront:()=>`<g filter="url(#paint)"><g fill="url(#hairM)" stroke="#170e08" stroke-width="2">${CURLS_FRONT}</g></g><path d="${CURL_MARKS}" fill="none" stroke="#6b4a33" stroke-width="2.2" stroke-linecap="round" opacity=".75"/>`,
  bust:()=>`<g filter="url(#paint)">
    <path d="M176,404 L224,404 L230,470 L170,470 Z" fill="url(#neckM)"/>
    <path d="M58,480 C66,446 118,432 166,428 L234,428 C282,432 334,446 342,480 Z" fill="url(#check)"/>
    <path d="M58,480 C66,446 118,432 166,428 L234,428 C282,432 334,446 342,480 Z" fill="url(#shirtShade)"/>
    <path d="M166,428 L200,456 L182,470 L150,438 Z M234,428 L200,456 L218,470 L250,438 Z" fill="#fbf4e6"/>
    <rect x="252" y="448" width="44" height="22" rx="2" fill="#fbf6ec"/><rect x="252" y="448" width="44" height="7" fill="#a8423a"/>
    <text x="274" y="466" text-anchor="middle" font-family="Patrick Hand, cursive" font-size="9" fill="${INK}">LOST PROP.</text></g>`
};
const WOMAN={
  key:"woman", label:"The neighbour", spot:"spotW", skin:"skinW", iris:"irisW", lid:"#ecb898", lidLow:"#eebd9e",
  head:"M200,84 C270,84 304,140 302,208 C300,282 272,350 236,392 C222,408 210,414 200,414 C190,414 178,408 164,392 C128,350 100,282 98,208 C96,140 130,84 200,84 Z",
  chinY:412, eyeY:232, eyeX:[156,244], eyeRx:33, eyeRy:37, lashes:true, bags:false,
  brow:{y:178, thin:4, thick:9, color:"#7a3a1c", spanL:[118,186], spanR:[214,282]},
  nose:"button", noseY:292, mouth:[200,344], lips:true, gap:false, stubble:false, ears:[],
  hairBack:()=>`<g filter="url(#paint)"><path d="M84,200 C62,120 112,46 200,44 C292,46 342,120 322,206 C330,270 346,330 334,400 C326,440 304,462 282,474 C292,420 288,360 268,330 L132,330 C112,360 108,420 118,474 C96,462 76,440 68,400 C56,330 70,270 84,200 Z" fill="url(#hairW)"/></g>
    <path d="M86,240 C70,300 92,360 74,440 M314,236 C334,300 312,370 330,450 M100,300 C92,360 110,400 96,470 M300,300 C312,360 292,410 306,470" fill="none" stroke="#e39a5c" stroke-width="3" stroke-linecap="round" opacity=".7"/>`,
  hairFront:()=>`<g filter="url(#paint)"><path d="M100,214 C92,128 146,72 214,74 C272,76 310,120 306,186 C292,140 258,116 222,118 C206,150 160,164 128,204 C116,218 106,232 100,214 Z" fill="url(#hairW)"/><path d="M296,170 C318,236 298,300 318,370 C292,330 286,250 288,184 Z" fill="url(#hairW)"/></g>
    <path d="M128,186 C150,150 190,128 222,118 M150,120 C180,96 230,88 272,108 M298,200 C306,250 298,300 310,350" fill="none" stroke="#f0ae72" stroke-width="2.6" stroke-linecap="round" opacity=".8"/>
    ${daisy(116,162,1.15,-30)}${daisy(136,128,1.0,-10)}${daisy(166,100,.95,10)}${daisy(270,96,1.0,20)}${daisy(296,124,1.15,35)}${daisy(310,160,.9,50)}
    <circle cx="104" cy="300" r="5" fill="#fbf7ee" stroke="#cfc6b5"/>`,
  bust:()=>`<g filter="url(#paint)">
    <path d="M178,396 L222,396 L228,452 L172,452 Z" fill="url(#neckW)"/>
    <path d="M70,480 C76,452 112,436 150,432 L250,432 C288,436 324,452 330,480 Z" fill="#efc3a3"/>
    <path d="M52,480 C58,458 92,446 120,446 L170,450 L200,480 Z M348,480 C342,458 308,446 280,446 L230,450 L200,480 Z" fill="url(#blouse)"/>
    <path d="M140,452 C160,466 182,474 200,480 C218,474 240,466 260,452" fill="none" stroke="#bfae8f" stroke-width="2"/></g>`
};
const CHARS={man:MAN,woman:WOMAN};

/* ================= rig ================= */
const BASE={bLo:0,bLi:0,bRi:0,bRo:0,lidT:.1,lidB:0,lidDL:0,lidDR:0,tilt:0,eyeS:1,eyeSL:1,eyeSR:1,pupS:1,px:0,py:0,mw:90,mo:2,ml:.2,mr:.2,teeth:0,tongue:0,flush:0,blush:.2,tears:0,sweat:0,vein:0,stretch:1,headTilt:0,noseS:1};
const BEATS={
 man:[
  {k:"smug",name:"Pleased with himself",note:"Chapter one. He's planted the whoopee cushion and can't wait.",p:{bLo:-48,bLi:-20,bRi:24,bRo:16,lidT:.3,lidDR:.34,eyeSL:1.16,eyeSR:.9,px:-14,py:-3,mw:196,mo:24,ml:1.7,mr:.25,teeth:1,blush:.5,headTilt:-11,stretch:.92}},
  {k:"egg",name:"\"...my egg?\"",note:"The bridge. His one lunch, gone.",p:{bLo:-62,bLi:-58,bRi:-58,bRo:-62,lidT:0,eyeS:1.38,pupS:.4,mw:50,mo:84,ml:0,mr:0,teeth:.2,stretch:1.22,noseS:.92}},
  {k:"fast",name:"\"Guess I'm fasting now...\"",note:"He says it like a joke. On a second look it isn't one.",p:{bLo:22,bLi:-50,bRi:-50,bRo:22,lidT:.56,lidB:.12,tilt:-.95,py:16,px:-6,mw:84,mo:2,ml:-1.5,mr:-1.15,stretch:.86,headTilt:12,eyeS:.96}},
  {k:"grit",name:"Gritted panic",note:"Chapter two. Something is very wrong with that last bite.",p:{bLo:-24,bLi:-46,bRi:-46,bRo:-24,lidT:0,eyeS:1.28,pupS:.36,px:10,mw:204,mo:54,ml:-.7,mr:-.3,teeth:1,flush:.35,sweat:1,stretch:1.1,headTilt:6}},
  {k:"choke",name:"Choking",note:"He wakes up and can't breathe. The mice panic.",p:{bLo:-66,bLi:-56,bRi:-56,bRo:-66,lidT:0,eyeS:1.46,eyeSL:1.1,eyeSR:.94,pupS:.32,py:-12,mw:104,mo:98,ml:-.3,mr:-.3,tongue:1,flush:1,sweat:1,vein:1,stretch:1.27,noseS:1.14,headTilt:-7}},
  {k:"rage",name:"Rage",note:"The grievance, for one frame, in chapter four. Never at the mice.",p:{bLo:-24,bLi:48,bRi:48,bRo:-24,lidT:.3,tilt:1.35,pupS:.7,mw:210,mo:60,ml:-.95,mr:-.85,teeth:1,flush:.9,vein:1,stretch:.8,noseS:1.18}},
  {k:"thanks",name:"Tearful thanks",note:"Chapter three. A stranger just saved his life.",p:{bLo:16,bLi:-48,bRi:-48,bRo:16,lidT:.34,lidB:.48,tilt:-.8,py:4,mw:160,mo:34,ml:1.25,mr:1.05,teeth:.55,blush:1,tears:1,stretch:.88,headTilt:-10}},
  {k:"quiet",name:"Quiet",note:"The finale. Nothing happens, and he's okay.",p:{bLo:4,bLi:-16,bRi:-16,bRo:4,lidT:.72,lidB:.34,tilt:-.3,mw:116,mo:3,ml:1.05,mr:.9,blush:.7,headTilt:-8,stretch:.95}}
 ],
 woman:[
  {k:"porch",name:"Porch light",note:"Chapter three opens. She hears glass break across the street.",p:{bLo:-10,bLi:-16,bRi:-16,bRo:-10,lidT:.06,eyeS:1.05,pupS:1.22,px:-8,mw:70,mo:4,ml:.5,mr:.4,blush:.45,headTilt:8}},
  {k:"alarm",name:"\"Oh my God\"",note:"She sees him on the concrete, choking.",p:{bLo:-44,bLi:-48,bRi:-48,bRo:-44,lidT:0,eyeS:1.2,pupS:.62,mw:44,mo:52,ml:0,mr:0,blush:.3,stretch:1.14}},
  {k:"push",name:"Heimlich",note:"Fists under his ribs. In, up. Again.",p:{bLo:-4,bLi:30,bRi:30,bRo:-4,lidT:.22,tilt:.95,pupS:1,mw:130,mo:26,ml:-.3,mr:-.3,teeth:1,flush:.4,blush:.4,stretch:.9,headTilt:-4}},
  {k:"there",name:"\"There you go\"",note:"The food flies out. She laughs from pure relief.",p:{bLo:-8,bLi:-22,bRi:-22,bRo:-8,lidT:.42,lidB:.36,tilt:-.4,mw:120,mo:26,ml:1.2,mr:1.05,teeth:.7,blush:.9,headTilt:-9,stretch:.94}}
 ]
};
const P=(c,k)=>Object.assign({},BASE,BEATS[c].find(b=>b.k===k).p);

function brow(x1,y1,x2,y2,thin,thick){const mx=(x1+x2)/2,my=(y1+y2)/2-12;return `M${x1},${y1} Q${mx},${my-thick/2} ${x2},${y2-thick/2} L${x2},${y2+thick/2} Q${mx},${my+thin} ${x1},${y1+thin/2} Z`}
function eye(id,C,side,p,blink){
  const cx=side==="L"?C.eyeX[0]:C.eyeX[1], cy=C.eyeY;
  const es=p.eyeS*(side==="L"?p.eyeSL:p.eyeSR), rx=C.eyeRx*es, ry=C.eyeRy*es;
  const lt=Math.max(clamp(p.lidT+(side==="L"?p.lidDL:p.lidDR),0,1),blink);
  const y0=cy-ry+lt*2*ry, yIn=y0+p.tilt*15, yOut=y0-p.tilt*15;
  const yLx=side==="L"?yOut:yIn, yRx=side==="L"?yIn:yOut, mid=(yLx+yRx)/2+(lt>.03?7:0);
  const y1=cy+ry-p.lidB*ry*(1-blink), lowMid=y1-(p.lidB>.05?10:0);
  const ix=cx+p.px, iy=cy+p.py, ir=(C.key==="woman"?18:15)*p.pupS;
  const outer=side==="L"?cx-rx:cx+rx, dir=side==="L"?-1:1, yOuterEdge=lt>.03?(side==="L"?yLx:yRx):cy-ry*.35;
  const lashes=C.lashes&&lt<.9?`<path d="M${outer},${yOuterEdge+2} l${dir*12},-8 M${outer-dir*6},${yOuterEdge-1} l${dir*9},-12 M${outer-dir*14},${yOuterEdge-4} l${dir*4},-12" stroke="${INK}" stroke-width="3" stroke-linecap="round"/>`:"";
  return `<clipPath id="${id}"><ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}"/></clipPath>
  <ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="#fbf6ec"/>
  <g clip-path="url(#${id})">
    <path d="M${cx-rx},${cy-ry+6} Q${cx},${cy-ry-6} ${cx+rx},${cy-ry+6} L${cx+rx},${cy-ry+22} Q${cx},${cy-ry+10} ${cx-rx},${cy-ry+22}Z" fill="#c9b9a5" opacity=".45"/>
    <circle cx="${ix}" cy="${iy}" r="${ir}" fill="url(#${C.iris})"/>
    <circle cx="${ix}" cy="${iy}" r="${ir*.52}" fill="#0d0805"/>
    <circle cx="${ix-ir*.32}" cy="${iy-ir*.38}" r="${Math.max(3,ir*.28)}" fill="#fff"/>
    <circle cx="${ix+ir*.3}" cy="${iy+ir*.36}" r="${Math.max(1.4,ir*.12)}" fill="#fff" opacity=".75"/>
    <path d="M${cx-rx-8},${cy-ry-12} L${cx+rx+8},${cy-ry-12} L${cx+rx+8},${yRx} Q${cx},${mid} ${cx-rx-8},${yLx} Z" fill="${C.lid}"/>
    <path d="M${cx-rx-8},${cy+ry+12} L${cx+rx+8},${cy+ry+12} L${cx+rx+8},${y1} Q${cx},${lowMid} ${cx-rx-8},${y1} Z" fill="${C.lidLow}"/>
  </g>
  ${lt>.03?`<path d="M${cx-rx-2},${yLx} Q${cx},${mid} ${cx+rx+2},${yRx}" fill="none" stroke="${INK}" stroke-width="${C.lashes?5:4.4}" stroke-linecap="round"/>`
         :`<path d="M${cx-rx},${cy} A${rx} ${ry} 0 0 1 ${cx+rx},${cy}" fill="none" stroke="${INK}" stroke-width="${C.lashes?5:4.4}" stroke-linecap="round"/>`}
  <path d="M${cx-rx},${cy} A${rx} ${ry} 0 0 0 ${cx+rx},${cy}" fill="none" stroke="${INK}" stroke-width="1.6" opacity="${C.lashes?.25:.55}"/>
  ${lashes}
  ${C.bags?`<path d="M${cx-rx*.85},${cy+ry+6} Q${cx},${cy+ry+20} ${cx+rx*.85},${cy+ry+6} M${cx-rx*.5},${cy+ry+16} Q${cx},${cy+ry+26} ${cx+rx*.5},${cy+ry+16}" fill="none" stroke="#9a5f48" stroke-width="2.4" opacity=".55"/>`:""}`;
}
function mouth(id,C,p){
  const cx=C.mouth[0],cy=C.mouth[1],L=[cx-p.mw/2,cy-p.ml*17],R=[cx+p.mw/2,cy-p.mr*17];
  const up=cy-p.mo*.35-(p.ml+p.mr)*3, low=cy+p.mo*1.15+(p.ml+p.mr)*8;
  const d=`M${L[0]},${L[1]} Q${cx},${up} ${R[0]},${R[1]} Q${cx},${low} ${L[0]},${L[1]} Z`;
  const tb=cy-p.mo*.12+p.teeth*p.mo*.42, lt=cy+p.mo*.95-p.teeth*p.mo*.48;
  let lines="";for(let x=cx-p.mw/2+15;x<cx+p.mw/2;x+=16)if(!C.gap||Math.abs(x-cx)>6)lines+=`M${x},${cy-60}V${cy+90}`;
  const crease=(x,y,s,v)=>`<path d="M${x},${y-9} q${s*10},6 ${s*4},18" fill="none" stroke="#b46f55" stroke-width="2.6" stroke-linecap="round" opacity="${clamp(v-.25,0,1)}"/>`;
  const lips=C.lips?`<path d="M${L[0]},${L[1]} Q${cx},${up} ${R[0]},${R[1]}" fill="none" stroke="#c8484f" stroke-width="6" stroke-linecap="round"/><path d="M${L[0]+4},${L[1]+1} Q${cx},${low+2} ${R[0]-4},${R[1]+1}" fill="none" stroke="#c8484f" stroke-width="9" stroke-linecap="round"/><path d="M${cx-10},${low+1} q10,3 20,0" stroke="#f3a0a0" stroke-width="2.4" fill="none" opacity=".8"/>`:"";
  return `<clipPath id="${id}"><path d="${d}"/></clipPath>
  <path d="${d}" fill="#5a1f22"/>
  <g clip-path="url(#${id})">
    <ellipse cx="${cx}" cy="${low-4}" rx="${p.mw*.28}" ry="${Math.max(2,p.mo*.32)}" fill="#c6555a" opacity="${.35+p.tongue*.65}"/>
    <rect x="${cx-p.mw}" y="${cy-70}" width="${p.mw*2}" height="${Math.max(0,tb-(cy-70))}" fill="#fbf4e6"/>
    ${C.gap?`<rect x="${cx-3.5}" y="${cy-70}" width="7" height="${Math.max(0,tb-(cy-70))}" fill="#5a1f22"/>`:""}
    <rect x="${cx-p.mw}" y="${lt}" width="${p.mw*2}" height="90" fill="#f1e7d5" opacity="${.3+p.teeth*.7}"/>
    <path d="${lines}" stroke="#cdbfa9" stroke-width="1.6" opacity="${.25+p.teeth*.7}"/>
  </g>
  ${lips}
  <path d="${d}" fill="none" stroke="${INK}" stroke-width="${C.lips?1.8:3.6}" stroke-linejoin="round"/>
  ${crease(L[0]-2,L[1],-1,p.ml)}${crease(R[0]+2,R[1],1,p.mr)}
  ${C.lips?"":`<path d="M${cx-20},${low+18} q20,8 40,0" fill="none" stroke="#b9785c" stroke-width="2" opacity=".5"/>`}`;
}
function nose(C,p){
  const y=C.noseY;
  if(C.nose==="bulb") return `<g transform="translate(200 ${y}) scale(${p.noseS}) translate(-200 ${-y})">
     <path d="M194,236 q-10,34 -16,58" fill="none" stroke="#b46f55" stroke-width="2.6" opacity=".45"/>
     <ellipse cx="204" cy="${y+30}" rx="34" ry="7" fill="#7a3e2c" opacity=".16"/>
     <ellipse cx="200" cy="${y}" rx="${C.noseR[0]}" ry="${C.noseR[1]}" fill="url(#nose)" stroke="#9d5d45" stroke-width="2"/>
     <ellipse cx="186" cy="${y+15}" rx="6" ry="3.4" fill="#5a2a22"/><ellipse cx="215" cy="${y+15}" rx="6" ry="3.4" fill="#5a2a22"/>
     <ellipse cx="188" cy="${y-10}" rx="9" ry="6" fill="#fff" opacity=".55"/></g>`;
  return `<g transform="translate(200 ${y}) scale(${p.noseS}) translate(-200 ${-y})">
     <path d="M198,${y-34} q-4,20 -8,28" fill="none" stroke="#d29a7e" stroke-width="2" opacity=".6"/>
     <path d="M188,${y} q2,10 12,10 q10,0 12,-8" fill="none" stroke="#b97a62" stroke-width="2.6" stroke-linecap="round"/>
     <ellipse cx="200" cy="${y-6}" rx="5" ry="3.4" fill="#fff" opacity=".5"/></g>`;
}
function head(pre,C,p,blink){
  const k=p.stretch, sx=1/Math.sqrt(k), cy=C.chinY;
  const [lx,rx]=C.eyeX, ey=C.eyeY, b=C.brow;
  const ears=C.ears.map(([x,y,a,bb,col])=>`<ellipse cx="${x}" cy="${y}" rx="${a}" ry="${bb}" fill="${col}"/><path d="M${x+(x<200?-4:4)},${y-16} q${x<200?14:-14},10 ${x<200?4:-4},32" fill="none" stroke="#a8644b" stroke-width="3"/>`).join("");
  const tear=(x)=>`<path d="M${x},${ey+40} C${x-6},${ey+80} ${x+10},${ey+110} ${x-2},${ey+150}" fill="none" stroke="#9fd0f0" stroke-width="7" stroke-linecap="round" opacity=".85"/><path d="M${x-2},${ey+150} q-8,14 0,20 q8,-6 0,-20z" fill="#9fd0f0" stroke="#5f8fb0" stroke-width="1.4"/>`;
  return `<g transform="rotate(${p.headTilt} 200 ${cy}) translate(200 ${cy}) scale(${sx.toFixed(4)} ${k.toFixed(4)}) translate(-200 ${-cy})">
   ${C.hairBack()}
   <g filter="url(#paint)">${ears}<path d="${C.head}" fill="url(#${C.skin})"/></g>
   <clipPath id="${pre}hc"><path d="${C.head}"/></clipPath>
   <g clip-path="url(#${pre}hc)">
     ${C.stubble?`<ellipse cx="200" cy="${cy-30}" rx="128" ry="74" fill="#5d6a7a" opacity=".2"/>`:""}
     <rect x="60" y="40" width="290" height="420" fill="#d9443b" opacity="${p.flush*.3}"/>
     <path d="${C.head}" fill="none" stroke="url(#rim)" stroke-width="14"/>
     <ellipse cx="200" cy="${cy+8}" rx="100" ry="40" fill="#8a4a35" opacity=".16"/>
   </g>
   <ellipse cx="${lx-28}" cy="${ey+66}" rx="30" ry="15" fill="#e7756a" opacity="${p.blush*.45+p.flush*.25}"/>
   <ellipse cx="${rx+28}" cy="${ey+66}" rx="30" ry="15" fill="#e7756a" opacity="${p.blush*.45+p.flush*.25}"/>
   ${eye(pre+"eL",C,"L",p,blink)}${eye(pre+"eR",C,"R",p,blink)}
   <path d="${brow(b.spanL[0],b.y+p.bLo,b.spanL[1],b.y+6+p.bLi,b.thin,b.thick)}" fill="${b.color}"/>
   <path d="${brow(b.spanR[1],b.y+p.bRo,b.spanR[0],b.y+6+p.bRi,b.thin,b.thick)}" fill="${b.color}"/>
   ${nose(C,p)}
   ${mouth(pre+"m",C,p)}
   <g opacity="${p.tears}">${tear(lx-6)}${tear(rx+6)}</g>
   <g opacity="${p.vein}"><path d="M252,104 l12,12 l-7,5 l14,12 M268,110 l-9,14" fill="none" stroke="#b0303a" stroke-width="4.5" stroke-linecap="round"/></g>
   ${C.hairFront()}
   <g opacity="${p.sweat}"><path d="M322,170 q-12,20 -5,30 q12,4 14,-10 q0,-11 -9,-20z" fill="#cfe9fb" stroke="#6f9cbd" stroke-width="1.6"/><path d="M342,140 l16,-12 M348,162 l18,-3 M90,150 l-16,-10" stroke="#2b1d1a" stroke-width="2.6" stroke-linecap="round"/></g>
  </g>`;
}
function faceSVG(pre,C,p,blink,bg){
  return `${bg?`<rect width="400" height="480" fill="url(#${C.spot})"/>`:`<rect width="400" height="480" fill="#f1e3c9"/>`}${C.bust()}${head(pre,C,p,blink)}`;
}


return {head,CHARS,P,BEATS};
})();
