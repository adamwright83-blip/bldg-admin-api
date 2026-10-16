/**
 * The operator's side of production conversation 86279c0b (2026-10-15,
 * 17:30–17:34 PT), verbatim from the persisted transcript, including its
 * speech-recognition errors. `standIn` is a neutral Claire line used only by
 * the in-memory replay when the ledger hands a turn to the conversational
 * pipeline (the database replay runs that pipeline for real instead).
 */
export type October15Step = { operator: string; standIn?: string };

export const OCTOBER_15_CALL: October15Step[] = [
  { operator: "Hey. It's Adam. I don't know. You called me and then you hung up.", standIn: "Sorry — that was my evening check-in and it dropped. What's going on?" },
  { operator: "I don't wanna talk about it. It's 05:30PM.", standIn: "Fair enough. What do you need right now?" },
  { operator: "I'm at Lugos Lavanderia.", standIn: "Got it, you're at Lugos." },
  { operator: "Our processing center.", standIn: "Right, the processing center." },
  { operator: "I have 3 dry cleaning orders. I need to see if those have been charged yet. If not, I need to charge them. I need to deliver 2 of them tonight." },
  { operator: "And 1 of them tomorrow morning." },
  { operator: "And before I leave work, I have to create a new page for our Laundry Farm landing page website." },
  { operator: "To align with the Instagram ad that I am creating also that says, skip laundry this week on us. We will pick up tomorrow, 20 pounds free. No charge today. Keep the monthly service only if you love it." },
  { operator: "Claim free order. So I have to create a landing page that matches that so that it converts actually." },
  { operator: "I just told you a lot of ****." },
  { operator: "Well, I want this to go on the record as a marketing challenge so that I get credit for it because it's important that everything I'm doing like this is recorded as either a marketing challenge or a sales mission or whatever it is. If in the case I do finish it. So you need to add it to the day line for today." },
  { operator: "I just told you something." },
  { operator: "The marketing challenge, I told you that I'm doing, as far as the website and the Instagram ad, go need to be added to the day line for today." },
];

