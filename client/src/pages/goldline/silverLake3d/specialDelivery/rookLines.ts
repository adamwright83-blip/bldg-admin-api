/**
 * What Rook says at his airmail station. Short, and never untrue: he cannot directly lie, so he never claims a flight
 * was meant, and he never says anything about a customer here (that is the correspondence desk's job, in plain words).
 * Most moments get no line at all; the animation does the work. A pool never repeats its last line.
 */
export const LINES = {
  intro_plan: ["Good. You're here. I have a plan."],
  intro_working: ["I'm still working on the plan."],
  intro_aim: ["Aim for the basket. Preferably not the cat."],
  bell_first: ["Well. She won't lose that."],
  next_delivery: ["Next delivery?"],
  bell_again: [
    "Every time.",
    "She's really committed to that bell.",
    "Bella's going to be very easy to find.",
    "I can hear that in my feet.",
    "That's the whole street awake.",
  ],
  miss: [
    "The ground signed for it.",
    "Close. In a broad sense.",
    "Delivered. To the courtyard.",
    "That one was a draft.",
    "Test flight.",
    "Paper's cheap. Mostly.",
  ],
  cat_first: ["She's fine. She's furious, but she's fine."],
  cat_again: [
    "Cleo would like that noted.",
    "She's keeping a list.",
    "Again: not the cat.",
    "She's pretending that didn't happen. So am I.",
  ],
  cat_assist_first: ["I'm putting her on the payroll."],
  away: [
    "It's having its own adventure.",
    "That's on a roof now. It lives there.",
    "Somebody's getting a surprise.",
  ],
  laundry: ["The laundry has it now.", "Folded into the sheets. Literally."],
  balcony: [
    "Technically on the balcony.",
    "So close she could reach it. She won't.",
  ],
  caught: ["Got it.", "Mine. Again?"],
  flick_missed: [
    "I helped. Not in a way you could measure.",
    "In my defence, I panicked.",
  ],
  two_cups: ["Two cups. Huh.", "One of those cups is flat."],
  orchestra_finale: ["That was the finale."],
  orchestra_again: ["Encore. A small one.", "They remember the tune."],
  orchestra_remembered: ["The cups haven't forgiven us."],
  improvements: ["I made improvements."],
  improvements_untested: ["I haven't tested them."],
  cat_remembered: ["Cleo's still not speaking to me."],
  welcome_back: [
    "Next delivery?",
    "The bell's ready. The cat is not.",
    "Mostly reliable. Ready when you are.",
  ],
  idle: [
    "Wind's good.",
    "I've folded forty-one of these.",
    "The fan has opinions.",
    "That basket's bigger than it looks.",
  ],
  fan_locked: ["Let's get one there first. Then we get clever."],
  fan_up: ["Fan's back to straight up."],
  fan_forward: ["Fan's leaning toward Bella. Feels like cheating."],
  fan_back: ["Fan's blowing at me now. Bold."],
  envelope_offer: ["I've got something for you, if you want to look."],
  // back from the desk: he acknowledges what you chose, and nothing more
  desk_back: ["Desk's always open.", "It'll be there."],
  desk_saved: [
    "It's on the desk when you want it.",
    "Filed under 'later'. Neatly.",
  ],
  desk_not_now: ["It'll keep.", "Another day, then."],
  desk_passed: ["Understood. I'll leave them be for a while."],
  desk_left_be: ["Leaving them be.", "As they asked."],
} satisfies Record<string, string[]>;

export type LineKey = keyof typeof LINES;

const last = new Map<LineKey, number>();

export function pickLine(
  key: LineKey,
  random: () => number = Math.random
): string {
  const pool = LINES[key];
  if (!pool?.length) return "";
  if (pool.length === 1) return pool[0];
  const prev = last.get(key);
  let i = Math.floor(random() * pool.length);
  if (i === prev) i = (i + 1) % pool.length;
  last.set(key, i);
  return pool[i];
}
