# Small Comforts — what is actually in the game

Read this before you describe, pitch, change or extend any Small Comforts chapter. Every fact here was
taken from the code on `main` on 2026-10-26: the narration comments in `ch1.html`–`ch3.html`, their
spoken lines, and `man.js`. If this file and the code ever disagree, the code wins. Fix this file in the
same change.

The game's deeper story belongs to Adam and is **deliberately kept out of this repo, because the repo
is public**. If you need it, ask Adam for the private story bible. Never commit its contents here.

## The cast

Exactly three mice and three people.

| Who | In the code | Looks | Does |
|---|---|---|---|
| **The Conductor** | `A` (3D rig `RA`) | grey, cream belly, navy cap | Leads: points, counts the others in, solves |
| **Biscuit** | `B` (`RB`) | golden-brown, chubby, **no hat** | Always hungry, gets stuck, the heavy one |
| **Pip** | `PIP` (`RC`; `__dbg.C`) | brown, smallest, matchstick crutch, bandage | Wants his bed on the shelf; the lookout |
| The man | `MAN`; face in `man.js` | flat paper cutout, curly hair, beard, shirt patch reading `LOST PROP.` | Lives alone; one egg for lunch |
| His daughter | `ch2.html` only | seen only on his phone screen and in her drawing taped inside the lid | Calls him |
| The neighbour | `WOM`; face in `man.js` | daisies in her hair, one arm in a cast | Lives across the path; does the Heimlich |

**There is no Baker and no Reader in the game.** An early story bible named four mice (the Conductor,
the Baker, the Reader, Biscuit). The build has the Conductor, Biscuit and Pip. Never call the Conductor
"the Reader", and never give Biscuit a baker's hat.

## Chapter One — Breakfast in Bed (`ch1.html`)

1. He comes home and leans over the open suitcase. He puts his one egg on top of the tin and zaps
   the lid with the joy buzzer on his finger. *"heh."* *"Lunch. Tomorrow."* He goes off to shower.
2. The Conductor and Pip come out. Pip wants his bed on the shelf, but he can't climb on a crutch.
   Something growls inside the zipped pocket above the shelf.
3. **Play: the shoelace.** The Conductor swings across the drop, lands on the tin and shoves the egg
   off. It bounces down, one note per bounce, and cracks. The yolk lands whole in the bottle cap.
4. **Play: the eggshells.** They become stairs to the shelf. Pip can't manage them on a crutch, so he
   takes the yolk in its cap and sits on the whoopee cushion to eat.
5. **Play: the cushion.** The Conductor bounces on it. He's too light, and Pip barely rises.
6. **Play: the zip.** The Conductor climbs the stairs and unzips the pocket, each tooth a rising note.
   Biscuit pops out, starving, and cannonballs onto the cushion. BRAAAP: Pip and his breakfast fly up
   into his bed. Biscuit crunches the stairs trying to follow.
7. The shower stops and everyone hides: the Conductor in a sock, Biscuit behind the spool with his
   belly sticking out both sides, Pip under the handkerchief. The man reaches for his egg.
   *"...my egg?"* His stomach growls. *"...Guess I'm fasting now."* Lights out, then one last toot.

**Wrong moves** (tapping the wrong thing before the shoelace): the tin wall (the Conductor gets about
one mouse up it), the cushion (it launches him into the socks), Pip (he tries to hop up to his bed),
the bottle cap (Antigravity's idea: it lands on Pip's head like a helmet and he walks blind into the
cushion).

## Chapter Two — This Is a Sign (`ch2.html`)

1. He sits by the suitcase and looks at the empty spot where his egg was, then at his daughter's
   drawing inside the lid. *"…tomorrow."* He trims his beard half-heartedly and falls asleep. The
   trimmer and its cord slide down into the mice's house, and his beard pours down over Biscuit.
2. **Play: the rig.** Biscuit rides the trimmer, sitting on the switch. The Conductor climbs the beard
   with Pip. Pip becomes the lookout on the bridge of his nose. The Conductor takes the cord out to the
   rim and hoists.
3. **Play: the haircut.** Hold and drag to cut. Pip warns when he stirs. Let go, and everyone goes
   limp until he settles.
4. A sneeze (CHOO) throws everyone off his face. He feels his chin and finds the cut.
   *"…this is a sign."* He smiles at the drawing and sleeps.
5. His phone slides into their house and starts buzzing, and the mice think it's a dying animal.
   **Play: phone pinball** inside the screen, with matchstick flippers. The apps are his things: the
   work alarm, a shopping list (eggs, again), her pictures, her lullaby, the rain. The lit lane leads
   to his daughter, and a video call starts.
6. He wakes to her voice. *"Daddy… you have a MOUSE?"* She sees the haircut. *"Did you eat
   today?"* *"…Big lunch."* She puts a finger to her lips. He sleeps again, and his stomach growls.
   *"…eggs…"* The mice look at the eggshell, guilty. The Conductor looks toward the kitchen bin.

**Wrong moves:**
- **During the rig:** pull the beard (it swings the Conductor like Tarzan), or tap the shoelace
  (Antigravity's idea: Biscuit grabs it and yo-yos up to the hook).
- **During the haircut:** drag like a maniac (the trimmer bucks Biscuit off and comes back with a dust
  bunny), or ignore Pip's warning. The first time, his hand swats and flings the Conductor round on
  the cord. The second time, all three play dead (Antigravity's idea).

## Chapter Three — Leftovers (`ch3.html`)

**Inside the suitcase**

1. The mice raid the bin and pile the week's leftovers on the rim. His palm lies on the rim with a
   crumb in it. Biscuit goes for the crumb: BZZT, the joy buzzer.
2. **Play: feed him on the in-breath**: crust, meatball, chicken. A scrap thrown on the out-breath
   blows straight back. The crust lands on Pip like a hat, the meatball bonks off the Conductor's cap,
   and the chicken leg knocks Biscuit over. Miss with the same scrap a second time and the crumbs end
   up in his moustache (Antigravity's idea).
3. The chicken goes down too big. He sits up, staggers back, and his back hits the window. The glass
   creaks. *"AAAAAAAAAH!"* The window gives, and the mice follow him through the broken glass.

**Outside, under his window.** Adam sometimes calls this part "Chapter Four". It is the second half of
`ch3.html`; there is no `ch4.html`.

4. He lies on his back on the grass with his heels hooked over the sill, stars and little birds round
   his head. The three shards of his window, one beside each mouse on the sill, shout *"WE'RE FREE!"*
5. A porch light comes on across the path, and the neighbour runs over. *"NEIGHBOR!"* *"Hang on!"*
   One good arm isn't enough, and the other is in a cast. *"Ow. Come ON."* Pip points at the cast, and
   the Conductor counts them in.
6. **Play: the Heimlich round.** She pushes on beat 4 of every bar. Each mouse leaps from the sill onto
   his stomach on its own count, cued by its shard singing its note while a ring closes. Round 1 is the
   Conductor alone; round 2 adds Biscuit, whose note comes first; round 3 adds Pip. On a good jump the
   glass with the microphone sings a line ("NO MORE PUTTY!", "GOODBYE, SILL!", …). On a miss, Biscuit
   lands in the daisy pot and comes out wearing one, the Conductor's cap lands on her head without her
   noticing, or Pip lands on the man's face and he goes cross-eyed.
7. The chicken bone flies out straight at the camera and splats on the lens. Two mice dive into his
   shirt pocket; Pip doesn't make it and freezes. She sees Pip. *"…oh. Hi."* She pets him.
   *"There you go."* The man: *"…thank you."* The Conductor's glass holds its microphone out to Pip. Pip
   sings one note, and the glass sings back: *"HAL-LE-LU-GLASS!"*

## Built vs. not built

- **Built:** the menu and chapters 1–3, exactly as above.
- **Not built:** anything after chapter 3. There is no `ch4.html`. Pitches for later chapters exist from
  Adam's story bible, Gemini and Antigravity. **None is approved.** Do not build one unless Adam names
  it.
- **On trial:** the ideas marked "Antigravity's idea" above, plus the shard lyrics and `?choir=b`. Adam
  is playing them to decide what stays. The [README](README.md) table says how to trigger each one.

## Rules for any new chapter

From Adam's story bible:

- People are flat paper cutouts, even in 3D scenes. Mice are always round, felt and three-dimensional.
- Every chapter has a new point of view (side cutaway, mouse-eye, ceiling-down, a peephole…).
- The mice never speak words, only symbols: `!` `?` `…` `♥`. The man speaks short, flat lines.
- Every solution ends in slapstick. Never a menu or a score.
- Nothing is explained in text. A stuck player gets shown the move (the ghost hand), never told it.
- The rain stays.
- Warmth enters his world only through the mice or another person.
- Never show a weapon, violence, or anyone being hurt or in danger. No countdowns. His daughter appears
  only as warmth: a drawing, a call, a sprinkler.
- Never draw new art over the existing plates. Use the props, mice and cutouts that exist.

## Mistakes agents have already made

| Wrong | Right |
|---|---|
| Biscuit's shoelace yo-yo is in Chapter 1 | Chapter 2, during the rig |
| Chapter 1 starts by freeing Biscuit from a zipper | Biscuit comes out of the pocket in step 6, near the end |
| A `?dead=b` switch for play-dead | Play-dead is what happens the second time you ignore Pip. The only URL switches are `?choir=a`/`?choir=b` (ch3) and `?ts=` (game speed) |
| "The Reader (Conductor)", or Biscuit in a baker's hat | There is no Reader or Baker. Biscuit has no hat |
| Five named shards (Tina, Pete, Mel, Carl, Lou) | Three shards, one per mouse, no names |
| A toaster fire in Chapter 1 sends him into the hall, where he meets the neighbour | Not in the game. He first meets her outside, in Chapter 3 |
| "Lunch. Tomorrow." is a date with the neighbour | It's Chapter 1: the egg is tomorrow's lunch |
| After the Heimlich he says "Lunch. Tomorrow." | He says "…thank you." |
| Mice in his coat pocket as he heads out | His shirt pocket, while he lies on the grass |
| Reading the game from a worktree or an old branch | Read `preview/small-comforts/` on `origin/main` |
