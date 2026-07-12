export const PRICING_FEATURES = [
  "Sage account ranking & business intelligence",
  "BORESLAY desktop missions",
  "Phone-guided field visits",
  "Pitch prep, quote sheets & printed leave-behinds",
  "Lapsed-customer recovery",
  "Onboarding included",
] as const;

export const SAGE_ACCOUNTS = [
  {
    account: "Westview Property Management",
    footprint: "15 buildings",
    annualValue: "$24,800",
    decisionMaker: "Operations manager",
    distance: "1.4 mi",
    probability: "High",
  },
  {
    account: "Harborlight Hotel",
    footprint: "44 rooms",
    annualValue: "$18,200",
    decisionMaker: "General manager",
    distance: "2.1 mi",
    probability: "High",
  },
  {
    account: "Meridian Physical Therapy",
    footprint: "3 locations",
    annualValue: "$9,600",
    decisionMaker: "Practice director",
    distance: "3.7 mi",
    probability: "Medium",
  },
] as const;

export const QUIET_CUSTOMERS = [
  { name: "Maya Chen", monthlyValue: "$680", daysQuiet: "46 days" },
  { name: "Luis Ortega", monthlyValue: "$540", daysQuiet: "58 days" },
  { name: "Amina Brooks", monthlyValue: "$720", daysQuiet: "63 days" },
] as const;

export const FAQS = [
  {
    id: "lead-list-or-map",
    question: "Is this just a lead list or a map?",
    answer:
      "No. A map shows every business. DayForge tells you which one is worth your time, what it's worth, who to ask for, and what to bring — then gets you there.",
  },
  {
    id: "game-required",
    question: "Do I have to play the game?",
    answer:
      "The game is how missions arrive — it's what makes them actually happen instead of sitting on a list. Sessions are short and built for a working owner's day.",
  },
  {
    id: "sales-experience",
    question: "What if I'm not good at sales?",
    answer:
      "Most owners aren't. That's why DayForge does the prep — who to ask for, what to lead with, answers to the usual objections, and a leave-behind that says it for you. You show up prepared, not slick.",
  },
  {
    id: "approval-control",
    question: "Does it contact anyone without my approval?",
    answer:
      "Never. DayForge prepares every message and every visit. You review, edit, and decide. Nothing moves without you.",
  },
  {
    id: "account-ranking",
    question: "How does DayForge decide an account is worth pursuing?",
    answer:
      "It weighs distance, business type, likely laundry demand, and estimated contract value, and ranks what's realistically winnable for a store your size.",
  },
  {
    id: "field-mission",
    question: "What happens on a field mission?",
    answer:
      "Your phone gives you the route, the prep, the person to ask for, the pitch, and the leave-behind. You drive, walk in, and ask for the business. Printed collateral is paid directly to the print shop at cost and is not included in the subscription.",
  },
  {
    id: "laundromats-only",
    question: "Is it only for laundromats?",
    answer:
      "DayForge for Laundry is built for fluff & fold and laundromat operators. More trades are coming.",
  },
  {
    id: "demo-expectations",
    question: "What happens in the 15-minute demo?",
    answer:
      "We pull up your address and map the winnable commercial accounts around your store, live. You keep what you see either way.",
  },
] as const;

export type FaqId = (typeof FAQS)[number]["id"];
