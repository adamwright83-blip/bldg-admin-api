# The account home: what it is for (UX intent, for reviewers)

Context for anyone reviewing the main account page at admin.gojoystick.com (story season on). It explains what the page
is trying to make an operator feel and do, and why. It is deliberately spoiler-free: the season's story lives in the
production database, never in this public repository.

## The one job

The operator opens JOYSTICK to check on their business. The page's job is to get them to play **one five-minute
chapter tonight**, and to want to come back tomorrow.

JOYSTICK is escapism from the business, not the business dressed up as a game. The business supplies the stakes and
the truthful numbers; the game is somewhere else. The page should feel like arriving in a world, not opening a
dashboard.

## What the operator sees, in order

1. **Their city, waking up** (first open of each day only). Every neighbourhood starts under cloud. The city
   brightens, then the clouds burn off over every neighbourhood where they really have customers. Their real business
   is what lights the world. Later opens the same day land on the lit city at once; reduced motion never animates.
2. **The game board arrives.** As the clouds lift, glass tiles drop in from above the frame and settle into a loop
   floating over the city, with the operator's adventurer standing on tonight's gold tile. The board is the season's
   spine.
3. **The numbers, at a glance.** Glass cards across the top: week to date, month to date, orders, new customers, each
   against the period before. Always truthful: anything the books cannot support reads "Not wired yet", never a made-up
   zero.
4. **Tonight's chapter.** A card on the left with the chapter's title, a short impossible hook, a line from Claire, and
   one button: PLAY TONIGHT'S CHAPTER. Five minutes, one game, a new clue.
5. **The neighbourhoods below,** with their real revenue and customer counts, always visible whatever the story does.

## Why it is shaped this way

- **One door, not a city of doors.** Showing every game at once overwhelms; one irresistible next step gets pressed.
  The operator's real bottleneck is starting, not capability.
- **A nightly ritual with a cliffhanger.** Serialized story (vertical-drama pacing, without paywalls): Claire reveals a
  little before the game, the game is played, and the ending answers something while opening something bigger. The
  next chapter opens the next night; real work is what moves the board.
- **Decisions are the cliffhanger.** After a chapter, Claire asks one question. The answer is final and quietly shapes
  later chapters. Players come back to see what was done with their answer.
- **Claire has two voices that never mix.** On calls and at the Desk she is factual business Claire with receipts. In
  the chapter she is a storyteller inside a fiction. Fiction never states a business fact; business Claire never
  references the story.
- **No shame mechanics.** Missed nights cost nothing; the story kept moving. Losing a game means retry.
- **The real business is the light.** Customers light neighbourhoods; uncharted places stay under cloud until a first
  customer there clears them.

## What is real today and what is not

- Real: the snapshot numbers, the neighbourhoods and their lit/clouded state, the opening sequence, the board, the
  chapter flow (play, win or retry, ending, question, answer saved, next chapter tomorrow).
- Placeholder: the chapter's game is a stand-in button game until the real chapter games are built; the dream board's
  squares are not yet tied to real work; chapter text may be placeholder in some environments.

## What review input is most useful

- Does the page feel like arriving somewhere you want to be, or like a dashboard with a picture behind it?
- Is the one action (PLAY) unmistakable within a second?
- Do the numbers read at a glance without competing with the world?
- Does the opening sequence earn its few seconds, and does it get in the way on a second visit?
- On a phone, does the chapter card still feel like an invitation?

Source of truth for the build: `server/story/README.md`, `client/src/pages/storyHome/`,
`client/src/components/admin/control-room/LanternCityIslands/skyBoard.ts`.
