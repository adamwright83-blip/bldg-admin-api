export type DaphneAggregatePriorInput = {
 actionKey:string;
 contextKey:string;
 cohortUserCount:number;
 successes:number;
 failures:number;
};

export type DaphneHierarchicalPrior = {
 actionKey:string;
 contextKey:string;
 alpha:number;
 beta:number;
 mean:number;
 cohortUserCount:number;
 provenance:"aggregate_cohort_only";
 usable:boolean;
 reason:string;
};

const FORBIDDEN_CONTEXT=/\b(race|ethnicity|religion|politic|sexual|health|diagnos|disability|adhd|bipolar)\b/i;

export function buildDaphneHierarchicalPrior(input:{
 aggregate:DaphneAggregatePriorInput;
 crossUserLearningEnabled:boolean;
 minCohortUsers?:number;
 baseAlpha?:number;
 baseBeta?:number;
}):DaphneHierarchicalPrior{
 const minUsers=Math.max(5,input.minCohortUsers??20);
 const a=input.aggregate;
 if(!input.crossUserLearningEnabled) return {actionKey:a.actionKey,contextKey:a.contextKey,alpha:1,beta:1,mean:.5,cohortUserCount:a.cohortUserCount,provenance:"aggregate_cohort_only",usable:false,reason:"user_cross_user_learning_disabled"};
 if(FORBIDDEN_CONTEXT.test(a.contextKey)) return {actionKey:a.actionKey,contextKey:a.contextKey,alpha:1,beta:1,mean:.5,cohortUserCount:a.cohortUserCount,provenance:"aggregate_cohort_only",usable:false,reason:"forbidden_sensitive_context"};
 if(a.cohortUserCount<minUsers) return {actionKey:a.actionKey,contextKey:a.contextKey,alpha:1,beta:1,mean:.5,cohortUserCount:a.cohortUserCount,provenance:"aggregate_cohort_only",usable:false,reason:"cohort_too_small"};
 if(a.successes<0||a.failures<0) throw new Error("Daphne aggregate prior counts cannot be negative");
 const alpha=(input.baseAlpha??1)+a.successes,beta=(input.baseBeta??1)+a.failures;
 return {actionKey:a.actionKey,contextKey:a.contextKey,alpha,beta,mean:Number((alpha/(alpha+beta)).toFixed(6)),cohortUserCount:a.cohortUserCount,provenance:"aggregate_cohort_only",usable:true,reason:"aggregate_cold_start_prior"};
}

export function shrinkDaphneUserRateTowardPrior(input:{successes:number;failures:number;prior:DaphneHierarchicalPrior}):number|null{
 if(!input.prior.usable) return null;
 if(input.successes<0||input.failures<0) throw new Error("Daphne user counts cannot be negative");
 const alpha=input.prior.alpha+input.successes,beta=input.prior.beta+input.failures;
 return Number((alpha/(alpha+beta)).toFixed(6));
}
