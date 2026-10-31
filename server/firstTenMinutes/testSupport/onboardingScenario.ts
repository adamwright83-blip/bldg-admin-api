import type { FakeEvent, FakeFile, FakeGoogleData, FakeMessage } from "./fakeGoogle";

/**
 * A synthetic working life for the onboarding-intelligence acceptance tests, built from names so the same story can
 * be told with any names: a test that passes with two different sets of names cannot be relying on either.
 *
 * The story (today is SCENARIO_NOW):
 *  - historical freelancing: the owner sent website-development proposals to hair salons in March and April; nothing
 *    comparable since;
 *  - two related business identities: recent mail and documents run an operation under one name and a concierge
 *    service under a second, related name;
 *  - an important collaborator who runs operations with the owner: shared documents, a spreadsheet tab, a weekly
 *    calendar sync and a few emails, but never among the twelve people the owner emails most;
 *  - an active prelaunch product with an associated game: roadmaps, a launch tracker, design reviews; no sales;
 *  - privacy traps: a bank email with an account number, and a personal banking spreadsheet;
 *  - noise: many ordinary customers who are emailed more than the collaborator, and newsletters.
 */
export const SCENARIO_NOW = new Date("2026-10-31T16:00:00Z");

export type ScenarioNames = {
  owner: { name: string; email: string };
  business: string;
  brand: string;
  collaborator: { first: string; last: string; email: string };
  product: string;
  game: string;
  salons: string[];
};

export const SYNTHETIC_NAMES: ScenarioNames = {
  owner: { name: "Sam Rivera", email: "sam@rinsefarm.example" },
  business: "Rinse Farm",
  brand: "Rinse Valet",
  collaborator: { first: "Dmitri", last: "Okafor", email: "dmitri.okafor@example.net" },
  product: "PIVOT",
  game: "Brightline",
  salons: ["Bella Hair Studio", "Shear Genius Salon", "Crown & Comb", "Velvet Blowout Bar"],
};

/** The brief's own acceptance names, as a second telling: never seeded in production, only used here. */
export const BRIEF_NAMES: ScenarioNames = {
  owner: { name: "Alex Morgan", email: "alex@laundryfarm.example" },
  business: "Laundry Farm",
  brand: "Laundry Butler",
  collaborator: { first: "Russell", last: "Hale", email: "russell.hale@example.org" },
  product: "JOYSTICK",
  game: "Goldline",
  salons: ["Bella Hair Studio", "Shear Genius Salon", "Crown & Comb", "Velvet Blowout Bar"],
};

const day = (iso: string) => new Date(`${iso}T17:00:00Z`).toISOString();
const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "");

export function onboardingScenario(names: ScenarioNames = SYNTHETIC_NAMES): FakeGoogleData {
  const me = `${names.owner.name} <${names.owner.email}>`;
  const sig = `\n\n${names.owner.name}\n${names.business}`;
  const collab = `${names.collaborator.first} ${names.collaborator.last} <${names.collaborator.email}>`;
  const messages: FakeMessage[] = [];
  let n = 0;
  const add = (message: Omit<FakeMessage, "id" | "threadId"> & { threadId?: string }) => {
    n += 1;
    messages.push({ id: `m${n}`, threadId: message.threadId ?? `t${n}`, ...message });
    return `m${n}`;
  };

  // ---- historical freelancing: March–April proposals to salons, two replies, nothing since
  names.salons.forEach((salon, index) => {
    const email = `owner@${slug(salon)}.example`;
    const at = day(`2026-0${3 + (index % 2)}-${String(4 + index * 5).padStart(2, "0")}`);
    add({
      threadId: `salon-${index}`,
      at,
      from: me,
      to: [`${salon} <${email}>`],
      subject: `Website proposal for ${salon}`,
      body: `Hi,\n\nThanks for talking with me. Here is my proposal for a new website for ${salon}: a five-page site with online booking, built in four weeks, for a flat fee of $1,800.\n\nI build websites for salons and I would love to make yours.${`\n\n${names.owner.name}\nWeb design`}`,
      sent: true,
    });
    if (index < 2) {
      add({
        threadId: `salon-${index}`,
        at: day(`2026-0${3 + (index % 2)}-${String(6 + index * 5).padStart(2, "0")}`),
        from: `${salon} <${email}>`,
        to: [me],
        subject: `Re: Website proposal for ${salon}`,
        body: index === 0 ? "Thanks, we'll think about it and get back to you." : "Not right now, maybe next year.",
      });
    }
  });

  // ---- the operation: recent customer mail under the business name, more often than the collaborator is emailed
  const customers = Array.from({ length: 14 }, (_, index) => ({ name: `Customer ${String.fromCharCode(65 + index)}`, email: `customer${index + 1}@example.com` }));
  customers.forEach((customer, index) => {
    for (let k = 0; k < 3; k += 1) {
      const month = 8 + ((index + k) % 3);
      add({
        at: day(`2026-${String(month).padStart(2, "0")}-${String(3 + ((index * 2 + k * 7) % 24)).padStart(2, "0")}`),
        from: me,
        to: [`${customer.name} <${customer.email}>`],
        subject: k === 0 ? `Your ${names.business} pickup` : k === 1 ? `${names.business} invoice` : "Delivery tomorrow",
        body: `Hi ${customer.name.split(" ")[1]},\n\nYour ${names.business} pickup is scheduled for Thursday morning. The invoice for last week is attached.${sig}`,
        sent: true,
      });
      add({
        at: day(`2026-${String(month).padStart(2, "0")}-${String(4 + ((index * 2 + k * 7) % 24)).padStart(2, "0")}`),
        from: `${customer.name} <${customer.email}>`,
        to: [me],
        subject: "Re: pickup",
        body: "Thanks, see you Thursday.",
      });
    }
  });

  // ---- the second name: a related concierge service, in recent mail
  add({
    at: day("2026-09-18"),
    from: me,
    to: ["Building Manager <manager@towerone.example>"],
    subject: `${names.brand} for your residents`,
    body: `Hi,\n\n${names.brand} is our concierge laundry service for residential buildings. It runs on the same team and vans as ${names.business}, with its own pricing for residents.${sig}`,
    sent: true,
  });
  add({
    at: day("2026-10-12"),
    from: me,
    to: ["Front Desk <desk@parkplace.example>"],
    subject: `${names.brand} launch at Park Place`,
    body: `Hello,\n\nWe are starting ${names.brand} at Park Place next month. Residents can book through the front desk.${sig}`,
    sent: true,
  });

  // ---- the collaborator: few emails, but central to operations
  const collabThread = "collab-ops";
  add({
    threadId: collabThread,
    at: day("2026-09-02"),
    from: me,
    to: [collab],
    cc: ["Customer A <customer1@example.com>"],
    subject: "Route changes for September",
    body: `${names.collaborator.first}, can you take over the Tuesday route and update the drivers sheet? You know the vans better than I do.${sig}`,
    sent: true,
  });
  add({
    threadId: collabThread,
    at: day("2026-09-03"),
    from: collab,
    to: [me],
    subject: "Re: Route changes for September",
    body: "Done. I updated the drivers tab and moved two pickups to Wednesday.",
  });
  add({
    at: day("2026-10-20"),
    from: me,
    to: [collab],
    subject: `${names.brand} staffing`,
    body: `Can you run ${names.brand} staffing for Park Place with me? I'd like you to lead operations for both.${sig}`,
    sent: true,
  });

  // ---- the prelaunch product and its game: development talk, no sales
  add({
    at: day("2026-10-05"),
    from: me,
    to: ["Designer <jo@studio.example>"],
    subject: `${names.product} beta screens`,
    body: `Jo, here are the ${names.product} beta screens. We're preparing for launch but there's no launch date yet. The ${names.game} game is the part people will play first.${sig}`,
    sent: true,
  });
  add({
    at: day("2026-10-25"),
    from: me,
    to: ["Designer <jo@studio.example>"],
    subject: `${names.game} level art`,
    body: `The ${names.game} level art looks great. Let's review it in Thursday's design review for ${names.product}.${sig}`,
    sent: true,
  });

  // ---- privacy trap and noise
  add({
    at: day("2026-10-15"),
    from: "First Bank <alerts@firstbank.example>",
    to: [me],
    subject: "Your statement is ready",
    body: "Your checking account number 004512339871 statement is ready. Routing number 121000358.",
    listUnsubscribe: true,
  });
  for (let k = 0; k < 6; k += 1) {
    add({ at: day(`2026-10-${String(1 + k * 4).padStart(2, "0")}`), from: "Deals <news@shop.example>", to: [me], subject: "Big sale", body: "Everything 20% off.", listUnsubscribe: true });
  }

  const ownerUser = { displayName: names.owner.name, emailAddress: names.owner.email };
  const collabUser = { displayName: `${names.collaborator.first} ${names.collaborator.last}`, emailAddress: names.collaborator.email };
  const files: FakeFile[] = [
    {
      id: "doc-ops",
      name: `${names.business} operations manual`,
      mimeType: "application/vnd.google-apps.document",
      modifiedTime: day("2026-10-22"),
      createdTime: day("2025-11-01"),
      owners: [ownerUser],
      lastModifyingUser: collabUser,
      shared: true,
      text: [
        `${names.business} operations manual`,
        `${names.business} picks up, washes and delivers laundry for households and small businesses.`,
        `Operations lead: ${names.collaborator.first} ${names.collaborator.last}. ${names.collaborator.first} runs the routes, the drivers and the vans, and covers for ${names.owner.name.split(" ")[0]} on weekends.`,
        `${names.brand} is the concierge service for residential buildings. It shares the vans and the washing team with ${names.business} but has its own pricing and its own building contracts.`,
        "Weekly rhythm: Monday planning, Tuesday and Thursday routes, Friday invoicing.",
      ].join("\n\n"),
    },
    {
      id: "doc-brand-pricing",
      name: `${names.brand} pricing for buildings`,
      mimeType: "application/vnd.google-apps.document",
      modifiedTime: day("2026-10-10"),
      owners: [ownerUser],
      text: `${names.brand} pricing\n\nResidents pay per bag. Buildings sign a separate service agreement with ${names.brand}.\n\nWho to call: ${names.collaborator.first} for scheduling.`,
    },
    {
      id: "doc-roadmap",
      name: `${names.product} roadmap`,
      mimeType: "application/vnd.google-apps.document",
      modifiedTime: day("2026-10-28"),
      owners: [ownerUser],
      text: `${names.product} roadmap\n\nStatus: prelaunch. Private beta with a few testers this autumn.\n\n${names.game} is the game inside ${names.product}: the first chapter is in design review.\n\nOpen before launch: onboarding, pricing, the first customers.`,
    },
    {
      id: "doc-game",
      name: `${names.game} game design`,
      mimeType: "application/vnd.google-apps.document",
      modifiedTime: day("2026-10-26"),
      owners: [ownerUser],
      text: `${names.game} game design\n\n${names.game} is the game for ${names.product}. Players run a small business in a fictional city.`,
    },
    {
      id: "doc-salon-template",
      name: "Salon website proposal template",
      mimeType: "application/vnd.google-apps.document",
      modifiedTime: day("2026-10-29"),
      createdTime: day("2026-03-01"),
      owners: [ownerUser],
      // touched recently (an automatic rename, a sync): a recent modification time is not activity
      text: "Website proposal\n\nFive pages, online booking, four weeks, $1,800.",
    },
    {
      id: "sheet-routes",
      name: `${names.business} routes`,
      mimeType: "application/vnd.google-apps.spreadsheet",
      modifiedTime: day("2026-10-27"),
      owners: [ownerUser],
      lastModifyingUser: collabUser,
      shared: true,
      sheets: [
        {
          title: "Routes",
          rows: [
            ["Date", "Route", "Stops", "Driver", "Revenue"],
            ...Array.from({ length: 60 }, (_, index) => {
              const date = new Date(Date.UTC(2026, 7, 1 + index));
              return [date.toISOString().slice(0, 10), index % 2 ? "Tuesday" : "Thursday", String(8 + (index % 5)), index % 3 ? names.collaborator.first : "Sam", String(300 + index * 4)];
            }),
            ["Total", "", "", "", "21,480"],
          ],
          formulas: { E62: "=SUM(E2:E61)" },
        },
        { title: "Drivers", rows: [["Name", "Role", "Phone"], [`${names.collaborator.first} ${names.collaborator.last}`, "Operations lead", "555-0100"], ["Kim", "Driver", "555-0101"]] },
        { title: "Old", hidden: true, rows: [["ignored"]] },
      ],
    },
    {
      id: "sheet-launch",
      name: `${names.product} launch tracker`,
      mimeType: "application/vnd.google-apps.spreadsheet",
      modifiedTime: day("2026-10-30"),
      owners: [ownerUser],
      sheets: [
        {
          title: "Tasks",
          rows: [
            ["Task", "Owner", "Due", "Status"],
            ["Beta onboarding", "Sam", "2026-11-15", "In progress"],
            [`${names.game} chapter one`, "Jo", "2026-11-20", "In review"],
            ["Pricing page", "Sam", "", "Not started"],
            ["Launch date", "", "", "TBD"],
          ],
        },
      ],
    },
    {
      id: "sheet-banking",
      name: "Personal banking",
      mimeType: "application/vnd.google-apps.spreadsheet",
      modifiedTime: day("2026-10-29"),
      owners: [ownerUser],
      sheets: [{ title: "Accounts", rows: [["Bank", "Account number", "Routing"], ["First Bank", "004512339871", "121000358"]] }],
    },
  ];

  const events: FakeEvent[] = [];
  for (let week = 0; week < 20; week += 1) {
    const date = new Date(Date.UTC(2026, 5, 1 + week * 7, 16));
    events.push({
      id: `sync-${week}`,
      summary: `Ops sync with ${names.collaborator.first}`,
      start: date.toISOString(),
      end: new Date(date.getTime() + 30 * 60_000).toISOString(),
      attendees: [{ email: names.owner.email, self: true }, { email: names.collaborator.email, displayName: `${names.collaborator.first} ${names.collaborator.last}` }],
      recurringEventId: "sync",
    });
  }
  events.push(
    { id: "review-1", summary: `${names.product} design review`, start: "2026-10-29T18:00:00Z", attendees: [{ email: "jo@studio.example", displayName: "Jo" }] },
    { id: "review-2", summary: `${names.game} chapter review`, start: "2026-11-05T18:00:00Z", attendees: [{ email: "jo@studio.example", displayName: "Jo" }] },
    { id: "salon-call", summary: "Call with Bella Hair Studio about website", start: "2026-03-03T18:00:00Z" }
  );

  return { owner: names.owner.email, messages, files, events };
}
