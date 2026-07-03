export const ARENA_WIDTH = 1200;
export const ARENA_HEIGHT = 650;

export type DemoStatus = "idle" | "playing" | "paused" | "victory" | "defeat";
export type Vec = { x: number; y: number };
export type Projectile = { id: number; kind: "fire" | "excuse"; x: number; y: number; vx: number; vy: number; radius: number };
export type Hazard = { id: number; x: number; y: number; radius: number; telegraphUntil: number; activeUntil: number; hit: boolean };
export type PresentationMode = "portrait" | "landscape";
export const getPresentationMode = (width: number, height: number, narrowTouchScreen = false): PresentationMode =>
  (width <= 700 && height > width) || narrowTouchScreen ? "portrait" : "landscape";

export type PublicBattleState = {
  time: number;
  status: DemoStatus;
  spark: Vec & { hp: number; energy: number; facing: Vec; dashUntil: number; dashReadyAt: number; invulnerableUntil: number };
  boss: Vec & { hp: number; staggerUntil: number; telegraph: "none" | "excuse" | "burst"; telegraphUntil: number };
  projectiles: Projectile[];
  hazards: Hazard[];
  influence: number;
  contractRemainingMs: number;
  fireReadyAt: number;
  nextBossAttackAt: number;
  nextId: number;
  message: string;
  lastBossHitAt: number;
  lastSparkHitAt: number;
  mission: { status: FollowUpMissionStatus; readyAt: number; deployment: SimulatedCrewMissionDeployment | null; progress: number; stage: number; dispatch: string | null; finalResultAt: number | null; strikeAt: number | null; rewardApplied: boolean };
};

export type PublicBusinessCombatResult = { source: "simulated-crew-mission"; simulated: true; label: string; bossDamage?: number; sparkEnergyRestore?: number; contractTimeRestoreMs?: number; influenceGain?: number; message?: string };

const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
const distance = (a: Vec, b: Vec) => Math.hypot(a.x - b.x, a.y - b.y);
const normalize = (v: Vec): Vec => {
  const d = Math.hypot(v.x, v.y) || 1;
  return { x: v.x / d, y: v.y / d };
};

export function createBattleState(): PublicBattleState {
  return {
    time: 0,
    status: "idle",
    spark: { x: 260, y: 440, hp: 100, energy: 100, facing: { x: 1, y: 0 }, dashUntil: 0, dashReadyAt: 0, invulnerableUntil: 0 },
    boss: { x: 930, y: 330, hp: 100, staggerUntil: 0, telegraph: "none", telegraphUntil: 0 },
    projectiles: [], hazards: [], influence: 50, contractRemainingMs: 270_000,
    fireReadyAt: 0, nextBossAttackAt: 2300, nextId: 1,
    message: "Press Play Demo to enter the arena.", lastBossHitAt: -1, lastSparkHitAt: -1,
    mission: { status: "charging", readyAt: 15000, deployment: null, progress: 0, stage: 0, dispatch: null, finalResultAt: null, strikeAt: null, rewardApplied: false },
  };
}

export class PublicBoreslayEngine {
  state = createBattleState();
  private movement: Vec = { x: 0, y: 0 };
  private attackIndex = 0;
  private missionAdapter = new BrowserLocalBoreslayDemoAdapter();

  start() { if (this.state.status === "idle" || this.state.status === "paused") { this.state.status = "playing"; this.state.message = "Move, dodge, and burn through the excuses."; } }
  pause() { if (this.state.status === "playing") { this.state.status = "paused"; this.state.message = "Battle paused. Your exact position is preserved."; } }
  reset() { this.state = createBattleState(); this.movement = { x: 0, y: 0 }; this.attackIndex = 0; this.missionAdapter.reset(); }
  setMovement(x: number, y: number) { this.movement = normalize({ x, y }); if (x === 0 && y === 0) this.movement = { x: 0, y: 0 }; }
  setAim(x: number, y: number) { this.state.spark.facing = normalize({ x: x - this.state.spark.x, y: y - this.state.spark.y }); }
  openFollowUpBriefing() { const m=this.state.mission;if(this.state.status!=="playing"||m.status!=="ready")return false;m.status="briefing";this.state.status="paused";this.state.message="SCOUT FOUND AN OPENING";return true; }
  closeFollowUpBriefing() { const m=this.state.mission;if(m.status!=="briefing")return false;m.status="ready";this.state.status="playing";this.state.message="Follow Up remains ready.";return true; }
  deployFollowUp() { const m=this.state.mission;if(m.status!=="briefing")return false;m.deployment=this.missionAdapter.deployCrewMission(this.state.time);m.status="working";this.state.status="playing";this.state.message="SCOUT DEPLOYED · CREW WORKING";return true; }
  applyBusinessCombatResult(result: PublicBusinessCombatResult) { if(!result.simulated||this.state.status!=="playing")return;this.hurtBoss(result.bossDamage??0,0);this.state.spark.energy=clamp(this.state.spark.energy+(result.sparkEnergyRestore??0),0,100);this.state.contractRemainingMs=Math.min(300000,this.state.contractRemainingMs+(result.contractTimeRestoreMs??0));this.state.influence=clamp(this.state.influence+(result.influenceGain??0),0,100);this.state.message=result.message??result.label; }

  dash() {
    const s = this.state;
    if (s.status !== "playing" || s.time < s.spark.dashReadyAt || s.spark.energy < 20) return false;
    const dir = this.movement.x || this.movement.y ? this.movement : s.spark.facing;
    s.spark.x = clamp(s.spark.x + dir.x * 135, 80, ARENA_WIDTH - 80);
    s.spark.y = clamp(s.spark.y + dir.y * 135, 170, ARENA_HEIGHT - 70);
    s.spark.energy -= 20; s.spark.dashUntil = s.time + 180; s.spark.invulnerableUntil = s.time + 420; s.spark.dashReadyAt = s.time + 1500;
    return true;
  }

  fire() {
    const s = this.state;
    if (s.status !== "playing" || s.time < s.fireReadyAt || s.spark.energy < 8) return false;
    const f = s.spark.facing;
    s.projectiles.push({ id: s.nextId++, kind: "fire", x: s.spark.x + f.x * 55, y: s.spark.y - 35 + f.y * 25, vx: f.x * 650, vy: f.y * 650, radius: 28 });
    s.spark.energy -= 8; s.fireReadyAt = s.time + 330;
    return true;
  }

  private hurtSpark(amount: number) {
    const s = this.state;
    if (s.time < s.spark.invulnerableUntil || s.status !== "playing") return false;
    s.spark.hp = Math.max(0, s.spark.hp - amount); s.spark.invulnerableUntil = s.time + 700; s.lastSparkHitAt = s.time; s.influence = clamp(s.influence - 7, 0, 100);
    if (s.spark.hp === 0) { s.status = "defeat"; s.influence = 5; s.message = "The Procrastinator wins this round. Rise and fight again."; }
    return true;
  }

  private hurtBoss(amount: number, influenceGain = 4) {
    const s = this.state;
    s.boss.hp = Math.max(0, s.boss.hp - amount); s.boss.staggerUntil = s.time + 260; s.lastBossHitAt = s.time; s.influence = clamp(s.influence + influenceGain, 0, 100);
    if (s.boss.hp === 0) { s.status = "victory"; s.influence = 100; s.message = "Contract conquered. The Procrastinator is defeated!"; }
  }

  private launchAttack() {
    const s = this.state;
    if (s.boss.telegraph !== "none") return;
    const kind = this.attackIndex++ % 2 === 0 ? "excuse" : "burst";
    s.boss.telegraph = kind; s.boss.telegraphUntil = s.time + (kind === "excuse" ? 720 : 900);
  }

  update(dtMs: number) {
    const s = this.state;
    if (s.status !== "playing") return;
    const dt = Math.min(dtMs, 50); s.time += dt; s.contractRemainingMs = Math.max(0, s.contractRemainingMs - dt);
    const speed = s.time < s.spark.dashUntil ? 520 : 235;
    s.spark.x = clamp(s.spark.x + this.movement.x * speed * dt / 1000, 70, ARENA_WIDTH - 70);
    s.spark.y = clamp(s.spark.y + this.movement.y * speed * dt / 1000, 180, ARENA_HEIGHT - 65);
    s.spark.energy = clamp(s.spark.energy + 10 * dt / 1000, 0, 100);

    const mission=s.mission;
    if(mission.status==="charging"&&s.time>=mission.readyAt){mission.status="ready";s.message="FOLLOW UP READY";}
    if((mission.status==="working"||mission.status==="result-incoming")&&mission.deployment){const p=this.missionAdapter.advanceCrewMission(mission.deployment,s.time);mission.progress=p.progress;if(p.stage>mission.stage){mission.stage=p.stage;mission.dispatch=p.message;if(p.stage===3){mission.status="final-result";mission.finalResultAt=s.time;}else mission.status="result-incoming";}}
    if(mission.status==="final-result"&&mission.finalResultAt!==null&&s.time-mission.finalResultAt>=3000&&!mission.rewardApplied&&mission.deployment){const result=this.missionAdapter.resolveCrewMission(mission.deployment);mission.rewardApplied=true;mission.status="strike";mission.strikeAt=s.time;this.applyBusinessCombatResult({source:"simulated-crew-mission",simulated:true,label:"FOLLOW-THROUGH STRIKE",bossDamage:result.combatRewards.bossDamage,influenceGain:result.combatRewards.influenceGain,sparkEnergyRestore:result.combatRewards.energyRestore,contractTimeRestoreMs:result.combatRewards.contractTimeRestoreMs,message:"THE CREW FOLLOWED THROUGH. +20 MOMENTUM."});}
    if(mission.status==="strike"&&mission.strikeAt!==null&&s.time-mission.strikeAt>=450)mission.status="resolved";

    if (s.time >= s.nextBossAttackAt && s.boss.telegraph === "none") this.launchAttack();
    if (s.boss.telegraph !== "none" && s.time >= s.boss.telegraphUntil) {
      if (s.boss.telegraph === "excuse") {
        const predicted = { x: s.spark.x + this.movement.x * 90, y: s.spark.y + this.movement.y * 90 };
        const dir = normalize({ x: predicted.x - s.boss.x, y: predicted.y - s.boss.y });
        s.projectiles.push({ id: s.nextId++, kind: "excuse", x: s.boss.x - 55, y: s.boss.y, vx: dir.x * 340, vy: dir.y * 340, radius: 32 });
      } else {
        s.hazards.push({ id: s.nextId++, x: s.spark.x, y: s.spark.y, radius: 115, telegraphUntil: s.time + 520, activeUntil: s.time + 900, hit: false });
      }
      s.boss.telegraph = "none"; s.nextBossAttackAt = s.time + 3000;
    }

    const live: Projectile[] = [];
    for (const p of s.projectiles) {
      p.x += p.vx * dt / 1000; p.y += p.vy * dt / 1000;
      if (p.kind === "fire" && distance(p, s.boss) < p.radius + 62) { this.hurtBoss(8); continue; }
      if (p.kind === "excuse" && distance(p, s.spark) < p.radius + 34) { this.hurtSpark(6); continue; }
      if (p.x > -80 && p.x < ARENA_WIDTH + 80 && p.y > -80 && p.y < ARENA_HEIGHT + 80) live.push(p);
    }
    s.projectiles = live;
    for (const h of s.hazards) if (!h.hit && s.time >= h.telegraphUntil && s.time <= h.activeUntil && distance(h, s.spark) < h.radius + 30) { h.hit = this.hurtSpark(8); }
    s.hazards = s.hazards.filter(h => s.time <= h.activeUntil);
  }
}
import { BrowserLocalBoreslayDemoAdapter, type FollowUpMissionStatus, type SimulatedCrewMissionDeployment } from "./PublicBoreslayDemoAdapter";
