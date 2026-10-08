export type DaphnePredictionCase = {
 prediction:number;
 outcome:0|1;
 contextKey:string;
 actionKey:string;
 burden?:number|null;
 causalStatus?:"none"|"observational"|"propensity_supported"|"randomized";
};

export type DaphneScientificEvaluation = {
 n:number;
 brierScore:number|null;
 logLoss:number|null;
 expectedCalibrationError:number|null;
 meanBurden:number|null;
 causalCoverage:{
  observational:number;
  propensitySupported:number;
  randomized:number;
 };
 contexts:number;
 actions:number;
 verdict:"insufficient_data"|"measured";
};

function p(value:number):number{
 if(!Number.isFinite(value)||value<0||value>1) throw new Error("Daphne prediction must be in [0,1]");
 return Math.max(1e-6,Math.min(1-1e-6,value));
}

export function evaluateDaphnePredictions(input:{
 cases:DaphnePredictionCase[];
 bins?:number;
 minN?:number;
}):DaphneScientificEvaluation{
 const minN=Math.max(1,input.minN??10);
 if(!input.cases.length) return {
  n:0,brierScore:null,logLoss:null,expectedCalibrationError:null,meanBurden:null,
  causalCoverage:{observational:0,propensitySupported:0,randomized:0},contexts:0,actions:0,verdict:"insufficient_data"
 };
 const cases=input.cases.map(c=>({...c,prediction:p(c.prediction)}));
 const n=cases.length;
 const brier=cases.reduce((s,c)=>s+(c.prediction-c.outcome)**2,0)/n;
 const log=cases.reduce((s,c)=>s-(c.outcome*Math.log(c.prediction)+(1-c.outcome)*Math.log(1-c.prediction)),0)/n;
 const bins=Math.max(2,Math.min(input.bins??10,50));
 let ece=0;
 for(let i=0;i<bins;i++){
  const lo=i/bins, hi=(i+1)/bins;
  const bucket=cases.filter(c=>c.prediction>=lo&&(i===bins-1?c.prediction<=hi:c.prediction<hi));
  if(!bucket.length) continue;
  const conf=bucket.reduce((s,c)=>s+c.prediction,0)/bucket.length;
  const acc=bucket.reduce((s,c)=>s+c.outcome,0)/bucket.length;
  ece+=(bucket.length/n)*Math.abs(conf-acc);
 }
 const burdens=cases.map(c=>c.burden).filter((v):v is number=>typeof v==="number"&&Number.isFinite(v));
 const share=(status:string)=>cases.filter(c=>c.causalStatus===status).length/n;
 return {
  n,brierScore:Number(brier.toFixed(6)),logLoss:Number(log.toFixed(6)),expectedCalibrationError:Number(ece.toFixed(6)),
  meanBurden:burdens.length?Number((burdens.reduce((a,b)=>a+b,0)/burdens.length).toFixed(6)):null,
  causalCoverage:{observational:Number(share("observational").toFixed(4)),propensitySupported:Number(share("propensity_supported").toFixed(4)),randomized:Number(share("randomized").toFixed(4))},
  contexts:new Set(cases.map(c=>c.contextKey)).size,actions:new Set(cases.map(c=>c.actionKey)).size,
  verdict:n>=minN?"measured":"insufficient_data",
 };
}

export function compareDaphneToBaseline(input:{
 daphne:DaphneScientificEvaluation;baseline:DaphneScientificEvaluation;
}){
 if(input.daphne.verdict!=="measured"||input.baseline.verdict!=="measured") return {verdict:"insufficient_data" as const};
 const brierDelta=(input.daphne.brierScore??Infinity)-(input.baseline.brierScore??Infinity);
 const burdenDelta=(input.daphne.meanBurden??0)-(input.baseline.meanBurden??0);
 return {
  verdict:"measured" as const,
  brierDelta:Number(brierDelta.toFixed(6)),
  burdenDelta:Number(burdenDelta.toFixed(6)),
  improvesCalibration:brierDelta<0,
  increasesBurden:burdenDelta>0,
 };
}
