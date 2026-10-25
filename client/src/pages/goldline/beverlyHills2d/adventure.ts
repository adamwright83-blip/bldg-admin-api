/** Fiction only. No game action can write outreach evidence or customer orders. */
export type Chapter = "courtyard" | "pasture" | "distortion" | "home";
export type Item = "ball" | "stick" | "rope" | null;
export type Adventure = {
  version: 1;
  chapter: Chapter;
  x: number;
  boxer: number;
  calf: number;
  facing: number;
  time: number;
  jump: number;
  jumpVelocity: number;
  item: Item;
  toy: number | null;
  chase: number;
  passage: boolean;
  metCalf: boolean;
  gate: boolean;
  water: boolean;
  tether: boolean;
  rescued: boolean;
  nuzzled: boolean;
  spooked: boolean;
  coyote: number;
  memory: number;
  notice: string;
};
export const CHAPTERS: Record<
  Chapter,
  { title: string; place: string; width: number }
> = {
  courtyard: {
    title: "A crack in the afternoon",
    place: "Beverly Hills · The courtyard",
    width: 2100,
  },
  pasture: {
    title: "Before the streets had names",
    place: "Rancho Rodeo de las Aguas · 1890s",
    width: 2900,
  },
  distortion: {
    title: "Something worth coming back for",
    place: "Two times · One small act of courage",
    width: 1900,
  },
  home: {
    title: "Room for everyone",
    place: "Beverly Hills · Then, and now",
    width: 1280,
  },
};
export function freshAdventure(): Adventure {
  return {
    version: 1,
    chapter: "courtyard",
    x: 220,
    boxer: 1530,
    calf: 1110,
    facing: 1,
    time: 0,
    jump: 0,
    jumpVelocity: 0,
    item: null,
    toy: null,
    chase: 0,
    passage: false,
    metCalf: false,
    gate: false,
    water: false,
    tether: false,
    rescued: false,
    nuzzled: false,
    spooked: false,
    coyote: 2480,
    memory: 0,
    notice: "",
  };
}
export function restoreAdventure(raw: string | null): Adventure {
  try {
    const r = JSON.parse(raw ?? "null");
    if (!r || r.version !== 1 || !Object.keys(CHAPTERS).includes(r.chapter))
      return freshAdventure();
    const s = freshAdventure();
    s.chapter = r.chapter;
    for (const k of [
      "passage",
      "metCalf",
      "gate",
      "water",
      "tether",
      "rescued",
      "nuzzled",
      "spooked",
    ] as const)
      s[k] = r[k] === true;
    for (const k of ["x", "boxer", "calf", "memory"] as const)
      if (Number.isFinite(r[k])) s[k] = r[k];
    s.x = Math.max(80, Math.min(CHAPTERS[s.chapter].width - 80, s.x));
    s.item = ["ball", "stick", "rope"].includes(r.item) ? r.item : null;
    // A thrown toy is transient. Give it back on resume, never strand a puzzle.
    if (!s.item && s.chapter === "courtyard" && !s.passage) s.item = "ball";
    if (!s.item && s.chapter === "pasture" && !s.gate) s.item = "stick";
    if (s.spooked) s.coyote = 3300;
    return s;
  } catch {
    return freshAdventure();
  }
}
export function hint(s: Adventure): string {
  if (s.chapter === "courtyard")
    return s.passage
      ? "The passage is open. Follow the cool air beneath the courtyard."
      : s.item === "ball"
        ? "He cannot resist a thrown ball. Try it away from the stairs."
        : "A red ball. A very possessive boxer. A doorway he will not leave.";
  if (s.chapter === "pasture")
    return !s.metCalf
      ? "Someone is waiting beneath the oak."
      : !s.gate
        ? "The calf follows him. A thrown stick could bring them both through the gate."
        : !s.water
          ? "He will not get his paws wet. You are small enough to hop across and open the sluice."
          : "The creek is low. Stay close to the calf and follow the field east.";
  if (s.chapter === "distortion")
    return !s.tether
      ? "Take the rope to the broken edge. This time, let him hold on."
      : !s.water
        ? "The old sluice still works. Water can lift the concrete platform."
        : "Go to the calf. Let it come to you.";
  return "Stay a little. There is room for all three of you.";
}
export type Prompt = { label: string; action: string } | null;
export function prompt(s: Adventure): Prompt {
  const near = (x: number, range = 125) => Math.abs(s.x - x) < range;
  if (s.chapter === "courtyard") {
    if (!s.item && near(s.toy ?? 480))
      return { label: "Pick up the ball", action: "ball" };
    if (near(1690))
      return {
        label: s.passage ? "Follow the passage" : "Sniff the passage",
        action: "passage",
      };
    if (near(820)) return { label: "Sniff the fountain", action: "fountain" };
  }
  if (s.chapter === "pasture") {
    if (!s.metCalf && near(1080, 220))
      return { label: "Say hello, quietly", action: "meet" };
    if (!s.gate && !s.item && near(s.toy ?? 1250))
      return { label: "Pick up the stick", action: "stick" };
    if (s.gate && near(2010))
      return {
        label: s.water ? "Listen to the stream" : "Pull the sluice",
        action: "sluice",
      };
    if (s.water && near(2730, 170))
      return { label: "Follow the calf", action: "rift" };
  }
  if (s.chapter === "distortion") {
    if (!s.item && !s.tether && near(400))
      return { label: "Pick up the rope", action: "rope" };
    if (s.item === "rope" && near(700))
      return { label: "Offer the rope to the boxer", action: "tether" };
    if (s.tether && near(1070))
      return {
        label: s.water ? "The platform is rising" : "Release the old waterway",
        action: "lift",
      };
    if (s.water && near(1490, 150))
      return { label: "Stay beside the calf", action: "rescue" };
  }
  return null;
}
export function interact(s: Adventure): boolean {
  const p = prompt(s);
  if (!p) return false;
  s.notice = "";
  switch (p.action) {
    case "ball":
      s.item = "ball";
      s.toy = null;
      break;
    case "stick":
      s.item = "stick";
      s.toy = null;
      break;
    case "fountain":
      s.notice = "A cool breeze. Somewhere below the stone.";
      break;
    case "passage":
      if (!s.passage) {
        s.notice =
          "A broad chest fills the doorway. His ears turn toward the ball.";
        break;
      }
      s.chapter = "pasture";
      s.x = 180;
      s.boxer = 620;
      s.calf = 1110;
      s.item = null;
      s.toy = null;
      s.chase = 0;
      break;
    case "meet":
      s.metCalf = true;
      s.memory = 6;
      s.notice = "The calf leans into him. You look away.";
      break;
    case "sluice":
      s.water = true;
      s.memory = 4;
      s.notice = "He tests one paw. Then another.";
      break;
    case "rift":
      s.chapter = "distortion";
      s.x = 180;
      s.boxer = 330;
      s.calf = 1490;
      s.water = false;
      s.item = null;
      s.toy = null;
      s.memory = 5;
      break;
    case "rope":
      s.item = "rope";
      break;
    case "tether":
      s.item = null;
      s.tether = true;
      s.memory = 3;
      s.notice = "For once, he holds something for you.";
      break;
    case "lift":
      s.water = true;
      s.memory = 5;
      break;
    case "rescue":
      s.rescued = true;
      s.nuzzled = true;
      s.memory = 7;
      s.notice = "";
      break;
  }
  return true;
}
export function throwToy(s: Adventure): boolean {
  if (s.item !== "ball" && s.item !== "stick") return false;
  s.toy = Math.max(
    150,
    Math.min(CHAPTERS[s.chapter].width - 150, s.x + s.facing * 400)
  );
  s.item = null;
  s.chase = 8;
  return true;
}
export function hop(s: Adventure) {
  if (s.jump === 0) s.jumpVelocity = 480;
}
const approach = (n: number, target: number, speed: number) =>
  n + Math.sign(target - n) * Math.min(Math.abs(target - n), speed);
export function tick(s: Adventure, delta: number, direction: number) {
  const dt = Math.min(delta, 0.05);
  s.time += dt;
  s.memory = Math.max(0, s.memory - dt);
  if (s.chapter === "home") return;
  if (s.rescued) {
    s.calf = approach(s.calf, s.x + 65, dt * 85);
    s.boxer = approach(s.boxer, s.x - 100, dt * 140);
    if (!s.memory) {
      s.chapter = "home";
      s.x = 640;
    }
    return;
  }
  if (direction) s.facing = Math.sign(direction);
  let next = s.x + direction * dt * 250;
  s.jump = Math.max(0, s.jump + s.jumpVelocity * dt);
  s.jumpVelocity -= dt * 1200;
  if (!s.jump) s.jumpVelocity = 0;
  if (s.chapter === "courtyard" && !s.passage) next = Math.min(next, 1450);
  if (s.chapter === "pasture") {
    if (!s.gate) next = Math.min(next, 1460);
    if (s.gate && !s.water && next > 1760 && next < 1900 && s.jump < 18) {
      next = s.x < 1830 ? 1755 : 1905;
      s.notice = "A little hop will do. He prefers dry paws.";
    }
  }
  if (s.chapter === "distortion" && !s.tether) next = Math.min(next, 760);
  if (s.chapter === "distortion" && !s.water) next = Math.min(next, 1190);
  s.x = Math.max(80, Math.min(CHAPTERS[s.chapter].width - 80, next));
  s.chase = Math.max(0, s.chase - dt);
  if (s.chapter === "courtyard") {
    s.boxer = approach(
      s.boxer,
      s.chase && s.toy !== null ? s.toy : s.passage ? s.x - 160 : 1530,
      dt * 320
    );
    if (
      s.toy !== null &&
      s.chase &&
      Math.abs(s.boxer - s.toy) < 35 &&
      s.toy < 1350
    )
      s.passage = true;
  }
  if (s.chapter === "pasture") {
    if (s.water && s.x > 2320 && !s.spooked) {
      s.spooked = true;
      s.x -= 55;
      s.jumpVelocity = 220;
      s.memory = 3;
    }
    if (s.spooked) s.coyote = approach(s.coyote, 3300, dt * 240);
    let target = !s.metCalf
      ? 1030
      : s.chase && s.toy !== null
        ? s.toy
        : s.gate
          ? s.x - 160
          : 1440;
    if (s.spooked && s.coyote < 2900) target = s.coyote - 120;
    if (!s.water) target = Math.min(1720, target);
    s.boxer = approach(s.boxer, target, dt * 270);
    if (
      s.metCalf &&
      s.chase &&
      s.toy !== null &&
      s.toy > 1550 &&
      s.boxer > 1500
    ) {
      s.gate = true;
      s.notice = "He shoulders the gate open. The calf follows.";
    }
    if (s.metCalf)
      s.calf = approach(s.calf, Math.max(800, s.boxer - 135), dt * 115);
  }
  if (s.chapter === "distortion")
    s.boxer = approach(s.boxer, s.tether ? 570 : s.x - 120, dt * 170);
}
