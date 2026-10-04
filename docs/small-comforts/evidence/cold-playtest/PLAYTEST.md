# Cold playtest: signal mirror (for whoever hands this to a tester)

The tester must never see this page or the README.

## Before
- Open the cold link on the tester's own device (mouse, landscape phone or portrait phone).
  Use `?playtest=mirror-cold`. Use `?playtest=mirror-hinted` only for a *second* tester or a second session, never first.
- You, the observer, add `&observer=1` on your own copy only. That shows two small buttons bottom-left: **Export session** and **New session**. The tester's link has neither.
- Keyboard shortcut for export on desktop: Shift+E.
- Start screen recording or just watch their hands. Do not talk.

## During
1. Do not explain what the button does.
2. Do not explain the controls.
3. Do not rescue the player immediately. Count to a full minute of nothing before you even consider it, and write down that you did.
4. Observe hands/actions before asking questions. Note what they tap, what they ignore, what they look at, anything they say aloud.

## After the session, ask only these four
- "What were you trying to do?"
- "What part, if any, did you want to keep messing with?"
- "What did you think the button was for?"
- "What did you expect to happen next?"

Do not follow up with leading questions. Do not tell them what the intended answer was until all four are answered.

## Record
- Exact quotes, in their words. Not "they liked it". Not "they were confused".
- Press **Export session** and keep the JSON. Name it with the tester's initials and the mode.
- Note anything the recorder cannot see: looking away, hesitating, a second person helping, you rescuing them (and when).

## What one session can and cannot do
- One session may **kill** a probe if its kill criterion clearly fires (see README, Falsifier).
- One successful session does **not** authorize systematizing the mechanic. Need a repeated pattern across naive sessions.
