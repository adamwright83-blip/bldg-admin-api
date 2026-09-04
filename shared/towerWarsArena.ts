export type HoldingEconomics={id:string;label:string;currentCents:number;priorCents:number|null};
export type TowerWarsArena =
 | {mode:"ZERO_HOLDING";title:"RAISE YOUR FIRST STRONGHOLD"}
 | {mode:"FOUNDING_SIEGE";holding:HoldingEconomics;enemy:{kind:"fictional_entropy";label:"Ruinbound pressure"}}
 | {mode:"GHOST_RIVALRY";holding:HoldingEconomics;ghost:{period:"prior";cents:number;classification:"game_projection"}}
 | {mode:"HOLDING_RIVALRY";holdings:[HoldingEconomics,HoldingEconomics]};
export function compileTowerWarsArena(holdings:HoldingEconomics[]):TowerWarsArena{
 const real=holdings.filter(h=>h.id&&h.label).sort((a,b)=>a.id.localeCompare(b.id));
 if(!real.length)return {mode:"ZERO_HOLDING",title:"RAISE YOUR FIRST STRONGHOLD"};
 if(real.length>=2)return {mode:"HOLDING_RIVALRY",holdings:[real[0],real[1]]};
 if(real[0].priorCents!==null)return {mode:"GHOST_RIVALRY",holding:real[0],ghost:{period:"prior",cents:real[0].priorCents,classification:"game_projection"}};
 return {mode:"FOUNDING_SIEGE",holding:real[0],enemy:{kind:"fictional_entropy",label:"Ruinbound pressure"}};
}
