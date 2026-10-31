#!/usr/bin/env node
/**
 * A local stand-in for Google and Slack, for the first-ten-minutes end-to-end run only.
 *
 * The server reaches it through JOYSTICK_FIRST_TEN_PROVIDER_ORIGIN, which server/firstTenMinutes/providerFetch.ts
 * honours only outside production: `https://<host>/<path>` becomes `<this origin>/<host>/<path>`. The browser reaches
 * it the same way, because the consent URL the server hands out is rewritten too.
 *
 *   node e2e/first-ten-minutes/fakeProviders.mjs            (listens on 127.0.0.1:4999, or FAKE_PROVIDERS_PORT)
 *
 * POST /__control with JSON changes what the next consent returns: { googleScopes: [...], deny: true } and so on.
 * POST /__reset puts everything back.
 */
import http from "node:http";
import corpus from "../../shared/firstTenMinutesExampleCorpus.json" with { type: "json" };
import extraction from "../../shared/firstTenMinutesExampleExtraction.json" with { type: "json" };

const PORT = Number(process.env.FAKE_PROVIDERS_PORT || 4999);

const ALL_GOOGLE_SCOPES = [
  "openid",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/drive.readonly",
];
const SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";

// a 1x1 JPEG, the stand-in for every attachment
const TINY_JPEG = Buffer.from(
  "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/yQALCAABAAEBAREA/8wABgAQEAX/2gAIAQEAAD8A0s8g/9k=",
  "base64"
);

/** Pacific time, as Google Calendar writes it for a calendar in Los Angeles. */
function pacific(iso) {
  const at = new Date(iso);
  const offset = at < new Date("2026-11-01T09:00:00Z") ? -7 : -8;
  const local = new Date(at.getTime() + offset * 3600_000).toISOString().slice(0, 19);
  return `${local}${offset === -7 ? "-07:00" : "-08:00"}`;
}

function gmailMessage(message) {
  const headers = [
    { name: "From", value: `${message.from.name} <${message.from.email}>` },
    { name: "To", value: message.to.map(to => `${to.name} <${to.email}>`).join(", ") },
    { name: "Subject", value: message.subject },
    { name: "Date", value: new Date(message.date).toUTCString() },
    ...(message.bulk ? [{ name: "List-Unsubscribe", value: "<mailto:unsubscribe@flowermarket.example>" }] : []),
  ];
  const parts = [{ mimeType: "text/plain", body: { data: Buffer.from(message.body, "utf8").toString("base64url"), size: message.body.length } }];
  for (const file of message.attachments) {
    parts.push({ mimeType: file.mimeType, filename: file.filename, body: { attachmentId: file.attachmentId, size: file.size } });
  }
  return {
    id: message.id,
    threadId: message.threadId,
    internalDate: String(new Date(message.date).getTime()),
    payload: { mimeType: "multipart/mixed", headers, parts },
  };
}

/**
 * The stand-in model's portrait of whoever the corpus describes: Nina's lines, citing the ids it was given, plus one
 * line about someone who isn't in the records, which the server must strike before anything is shown.
 */
function fakePortrait(corpusText) {
  let corpus;
  try {
    corpus = JSON.parse(corpusText);
  } catch {
    return { paragraphs: [] };
  }
  const findings = corpus.findings ?? [];
  const id = (kind, test = () => true) => findings.find(finding => finding.kind === kind && test(finding))?.id;
  const ids = (...values) => values.filter(Boolean);
  const jules = id("person", finding => finding.fact.includes("Jules"));
  return {
    paragraphs: [
      {
        sentences: [
          { text: "Weddings fill your weekends.", findingIds: ids(id("rhythm"), id("contrast")) },
          { text: "You're building a steadier weekday business around hotel flowers.", findingIds: ids(id("service"), id("route")) },
        ],
      },
      {
        sentences: [
          { text: "Jules handles the installations.", findingIds: ids(jules) },
          { text: "Marta keeps the books.", findingIds: ids(jules) },
        ],
      },
      {
        sentences: [{ text: "You've added Friday deliveries and kept Sundays for yourself.", findingIds: ids(id("service"), id("rule")) }],
      },
    ],
  };
}

/**
 * The stand-in model as Claire on the first-chapter page: it writes from what read_first_chapter returned, the way a
 * faithful answer would. With `claireOverclaims` it says the message went and was answered, which the page must refuse.
 */
function fakeClaire(facts) {
  if (control.claireOverclaims) return "It went out this morning, and Elena replied.";
  const name = facts.recipient.firstName ?? facts.recipient.name ?? facts.recipient.address;
  const at = time => (time ? ` ${time}` : "");
  const words = `“${facts.message.words}”`;
  const parts = [`You picked up ${facts.request.label}${facts.request.askedIn ? ` from ${facts.request.askedIn}` : ""}.`];
  if (facts.message.version === "their_own_words") parts.push(`You put the reply in your own words: ${words}`);
  else if (facts.message.version === "the_shorter_one") parts.push(`You chose the shorter reply: ${words}`);
  else if (facts.message.version === "the_one_offering_to_start") parts.push(`You chose the reply offering to start: ${words}`);
  else parts.push(`You kept the reply as it was drafted: ${words}`);
  if (facts.message.state === "ready_not_sent") parts.push("It's ready, and it hasn't been sent.");
  if (facts.message.state === "kept_for_later") parts.push("You decided it could wait. It hasn't been sent.");
  if (facts.message.state === "sending_not_confirmed") parts.push("JOYSTICK asked your Gmail to send it, and I haven't seen it go yet.");
  if (facts.message.state === "opened_in_their_mail" || facts.message.state === "copied_by_them") {
    const left = facts.message.state === "copied_by_them" ? "You copied it" : "You opened it in your Gmail";
    parts.push(
      `${left}${at(facts.message.leftTheTable)}. ${
        facts.sentFolder === "looked_just_now_not_there"
          ? "It isn't in your Sent folder, so as far as I can tell it hasn't gone yet."
          : "I couldn't look in your Sent folder just now, so I don't know yet whether it went."
      }`
    );
  }
  if (facts.message.state === "they_said_they_sent_it") {
    parts.push(`You told me you sent it${at(facts.message.theySaidSent)}. ${facts.sentFolder === "looked_just_now_not_there" ? "I haven't found it in your Sent folder." : "I couldn't look in your Sent folder just now."}`);
  }
  if (facts.message.state === "in_their_sent_folder") parts.push(facts.message.inSentFolderSince ? `It's in your Sent folder, sent ${facts.message.inSentFolderSince}.` : "It's in your Sent folder.");
  if (facts.recipientWroteBack.answer === "no") parts.push(`${name} hasn't written back yet.`);
  if (facts.recipientWroteBack.answer === "yes") parts.push(`${name} wrote back${at(facts.recipientWroteBack.when)}: “${facts.recipientWroteBack.words}”`);
  return parts.join(" ");
}

const modelCalls = [];
/** what the person "sent from Gmail" during a test, after JOYSTICK handed the message over */
const sentLater = [];
/** what someone wrote back to the person during a test */
const receivedLater = [];
/** what JOYSTICK sent through users.messages.send, exactly as Google received it */
const apiSends = [];
/** the person allowed sending on Google's consent screen (asked for with gmail.send) */
let sendGranted = false;
const grantedScopes = () => [...control.googleScopes, ...(sendGranted ? [SEND_SCOPE] : [])].join(" ");

const defaults = () => ({
  googleScopes: ALL_GOOGLE_SCOPES,
  googleEmail: "owner@first-ten.example",
  deny: false,
  slackTeam: "First Ten Workspace",
  modelFails: false,
  // Claire's answer on the first-chapter page says what the records don't
  claireOverclaims: false,
  // the email reading takes this long to come back, so a test can watch the reading while it works
  conversationsDelayMs: 0,
  // on Google's consent screen, the person unticks "Send email on your behalf"
  refuseSend: false,
  // users.messages.send answers: "ok", a refusal ("refuse"), or accepted but the answer never arrives ("lose")
  sendAnswer: "ok",
});
let control = defaults();
const revoked = [];

function send(res, status, body, headers = {}) {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  res.writeHead(status, { "content-type": typeof body === "string" ? "text/plain" : "application/json", ...headers });
  res.end(text);
}

function readBody(req) {
  return new Promise(resolve => {
    let data = "";
    req.on("data", chunk => (data += chunk));
    req.on("end", () => resolve(data));
  });
}

function consent(url, res, code) {
  const redirect = url.searchParams.get("redirect_uri");
  const state = url.searchParams.get("state");
  if (!redirect || !state) return send(res, 400, "missing redirect_uri or state");
  const back = new URL(redirect);
  if (control.deny) back.searchParams.set("error", "access_denied");
  else back.searchParams.set("code", code);
  back.searchParams.set("state", state);
  res.writeHead(302, { location: back.toString() });
  res.end();
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const body = req.method === "POST" ? await readBody(req) : "";
  const path = url.pathname;

  if (path === "/__control" && req.method === "POST") {
    const { revokeSend, ...changes } = JSON.parse(body || "{}");
    // the person took JOYSTICK's permission to send away at Google, behind JOYSTICK's back
    if (revokeSend) sendGranted = false;
    control = { ...control, ...changes };
    return send(res, 200, { ok: true, control });
  }
  if (path === "/__reset" && req.method === "POST") {
    control = defaults();
    revoked.length = 0;
    modelCalls.length = 0;
    sentLater.length = 0;
    receivedLater.length = 0;
    apiSends.length = 0;
    sendGranted = false;
    return send(res, 200, { ok: true });
  }
  if (path === "/__revoked") return send(res, 200, { revoked });
  if (path === "/__api-sends") return send(res, 200, { sends: apiSends });
  // the person sends the message from their own Gmail: it lands in their Sent folder, now
  if (path === "/__send-from-gmail" && req.method === "POST") {
    const input = JSON.parse(body || "{}");
    sentLater.push({
      id: `m-sent-later-${sentLater.length + 1}`,
      threadId: "t-sent-later",
      date: new Date().toISOString(),
      from: { name: corpus.owner.name, email: corpus.owner.email },
      to: [{ name: input.toName ?? "", email: input.to }],
      subject: input.subject ?? "",
      body: input.body ?? "",
      attachments: [],
    });
    return send(res, 200, { ok: true });
  }

  // someone writes back to the person: it lands in their inbox, now
  if (path === "/__reply-from" && req.method === "POST") {
    const input = JSON.parse(body || "{}");
    receivedLater.push({
      id: `m-received-later-${receivedLater.length + 1}`,
      threadId: "t-sent-later",
      date: new Date().toISOString(),
      from: { name: input.fromName ?? "", email: input.from },
      to: [{ name: corpus.owner.name, email: corpus.owner.email }],
      subject: input.subject ?? "",
      body: input.body ?? "",
      attachments: [],
    });
    return send(res, 200, { ok: true });
  }

  // ---------------------------------------------------------------- Google
  if (path === "/accounts.google.com/o/oauth2/v2/auth") {
    if ((url.searchParams.get("scope") ?? "").split(" ").includes(SEND_SCOPE) && !control.refuseSend && !control.deny) sendGranted = true;
    return consent(url, res, "fake-google-code");
  }
  if (path === "/oauth2.googleapis.com/token" && req.method === "POST") {
    const form = new URLSearchParams(body);
    if (form.get("grant_type") === "refresh_token") {
      return send(res, 200, { access_token: `fake-google-access-${Date.now()}`, expires_in: 3599, scope: grantedScopes() });
    }
    if (form.get("code") !== "fake-google-code") return send(res, 400, { error: "invalid_grant" });
    return send(res, 200, {
      access_token: "fake-google-access",
      refresh_token: "fake-google-refresh",
      expires_in: 3599,
      scope: grantedScopes(),
      token_type: "Bearer",
    });
  }
  if (path === "/openidconnect.googleapis.com/v1/userinfo") {
    return send(res, 200, { sub: "fake-sub-1", email: control.googleEmail, email_verified: true, name: "First Ten Owner", given_name: "Owner" });
  }
  if (path === "/oauth2.googleapis.com/revoke" && req.method === "POST") {
    revoked.push({ provider: "google", token: new URLSearchParams(body).get("token") });
    return send(res, 200, {});
  }

  // ---------------------------------------------------------------- Gmail, Calendar, Drive (Nina's invented corpus)
  if (path === "/gmail.googleapis.com/gmail/v1/users/me/profile") return send(res, 200, { emailAddress: control.googleEmail });
  // JOYSTICK sends from the person's Gmail: it lands in their Sent folder, with the Message-ID it was given
  if (path === "/gmail.googleapis.com/gmail/v1/users/me/messages/send" && req.method === "POST") {
    if (!sendGranted) return send(res, 403, { error: { code: 403, status: "PERMISSION_DENIED", message: "Request had insufficient authentication scopes." } });
    if (control.sendAnswer === "refuse") return send(res, 400, { error: { code: 400, status: "INVALID_ARGUMENT", message: "Invalid To header" } });
    const raw = Buffer.from(JSON.parse(body).raw, "base64url").toString("utf8");
    const [head, encoded] = raw.split("\r\n\r\n");
    const header = name => head.match(new RegExp(`^${name}: (.*)$`, "mi"))?.[1]?.trim() ?? "";
    const address = header("To").match(/<([^>]+)>/)?.[1] ?? header("To");
    const message = {
      id: `m-api-sent-${apiSends.length + 1}`,
      threadId: "t-sent-later",
      rfc822: header("Message-ID"),
      date: new Date().toISOString(),
      from: { name: corpus.owner.name, email: corpus.owner.email },
      to: [{ name: "", email: address }],
      subject: header("Subject"),
      body: Buffer.from(encoded.replace(/\r\n/g, ""), "base64").toString("utf8"),
      attachments: [],
    };
    apiSends.push({ id: message.id, from: header("From"), to: header("To"), subject: message.subject, body: message.body, messageId: message.rfc822 });
    sentLater.push(message);
    if (control.sendAnswer === "lose") {
      res.destroy();
      return;
    }
    return send(res, 200, { id: message.id, threadId: message.threadId, labelIds: ["SENT"] });
  }
  if (path === "/gmail.googleapis.com/gmail/v1/users/me/messages") {
    const q = url.searchParams.get("q") ?? "";
    const rfc822 = q.match(/(?:^|\s)rfc822msgid:(\S+)/)?.[1] ?? null;
    if (rfc822) {
      const found = sentLater.filter(message => message.rfc822?.replace(/^<|>$/g, "") === rfc822).map(message => ({ id: message.id, threadId: message.threadId }));
      return send(res, 200, { messages: found, resultSizeEstimate: found.length });
    }
    const sent = /(^|\s)in:sent\b/.test(q);
    const to = q.match(/(?:^|\s)to:(\S+)/)?.[1]?.toLowerCase() ?? null;
    const from = q.match(/(?:^|\s)from:(\S+)/)?.[1]?.toLowerCase() ?? null;
    const after = Number(q.match(/(?:^|\s)after:(\d+)/)?.[1] ?? 0) * 1000;
    const ids = [...corpus.messages, ...sentLater, ...receivedLater]
      .filter(message => (message.from.email === corpus.owner.email) === sent)
      .filter(message => !to || message.to.some(recipient => recipient.email.toLowerCase() === to))
      .filter(message => !from || message.from.email.toLowerCase() === from)
      .filter(message => !after || new Date(message.date).getTime() >= after)
      .map(message => ({ id: message.id, threadId: message.threadId }));
    return send(res, 200, { messages: ids.reverse(), resultSizeEstimate: ids.length });
  }
  const attachment = path.match(/^\/gmail\.googleapis\.com\/gmail\/v1\/users\/me\/messages\/([^/]+)\/attachments\/([^/]+)$/);
  if (attachment) return send(res, 200, { data: TINY_JPEG.toString("base64url"), size: TINY_JPEG.length });
  const one = path.match(/^\/gmail\.googleapis\.com\/gmail\/v1\/users\/me\/messages\/([^/]+)$/);
  if (one) {
    const message = [...corpus.messages, ...sentLater, ...receivedLater].find(candidate => candidate.id === decodeURIComponent(one[1]));
    return message ? send(res, 200, gmailMessage(message)) : send(res, 404, { error: "not found" });
  }
  if (path === "/www.googleapis.com/calendar/v3/calendars/primary/events") {
    const from = new Date(url.searchParams.get("timeMin") ?? 0);
    const to = new Date(url.searchParams.get("timeMax") ?? "2100-01-01");
    const items = corpus.events
      .filter(event => new Date(event.start) >= from && new Date(event.start) <= to)
      .map(event => ({
        id: event.id,
        status: "confirmed",
        summary: event.summary,
        location: event.location ?? undefined,
        recurringEventId: event.recurringEventId ?? undefined,
        htmlLink: `https://calendar.google.com/calendar/event?eid=${event.id}`,
        start: { dateTime: pacific(event.start) },
        end: { dateTime: pacific(event.end) },
      }));
    return send(res, 200, { items });
  }
  if (path === "/www.googleapis.com/drive/v3/files") {
    return send(res, 200, {
      files: corpus.files.map(file => ({ id: file.id, name: file.name, mimeType: file.mimeType, modifiedTime: file.modifiedTime, md5Checksum: file.md5Checksum, webViewLink: `https://drive.google.com/file/d/${file.id}/view` })),
    });
  }
  const exported = path.match(/^\/www\.googleapis\.com\/drive\/v3\/files\/([^/]+)\/export$/);
  if (exported) {
    const file = corpus.files.find(candidate => candidate.id === decodeURIComponent(exported[1]));
    return file?.text ? send(res, 200, file.text) : send(res, 404, "not a document");
  }
  if (path === "/maps.googleapis.com/maps/api/geocode/json") {
    const found = corpus.geocodes[url.searchParams.get("address") ?? ""];
    return send(res, 200, found
      ? { status: "OK", results: [{ formatted_address: found.formatted, place_id: "fake", geometry: { location: { lat: found.lat, lng: found.lng } } }] }
      : { status: "ZERO_RESULTS", results: [] });
  }

  // ---------------------------------------------------------------- Anthropic (the model's two readings of Nina's corpus, Claire's portrait, and Claire on the page)
  if (path === "/anthropic/v1/messages" && req.method === "POST") {
    const request = JSON.parse(body || "{}");
    const system = typeof request.system === "string" ? request.system : JSON.stringify(request.system ?? "");
    if (control.modelFails) return send(res, 500, { type: "error", error: { type: "api_error", message: "stand-in failure" } });
    // Claire on the first-chapter page, through her engine's tool loop: she reads first, then writes from what she read
    if (system.includes("Call read_first_chapter first")) {
      const last = (request.messages ?? []).at(-1);
      const result = Array.isArray(last?.content) ? last.content.find(part => part.type === "tool_result") : null;
      modelCalls.push("claire");
      const reply = content => ({
        id: `msg_fake_${modelCalls.length}`,
        type: "message",
        role: "assistant",
        model: request.model,
        content,
        stop_reason: content.some(part => part.type === "tool_use") ? "tool_use" : "end_turn",
        stop_sequence: null,
        usage: { input_tokens: 900, output_tokens: 120 },
      });
      if (!result) return send(res, 200, reply([{ type: "tool_use", id: `toolu_fake_${modelCalls.length}`, name: "read_first_chapter", input: {} }]));
      const read = typeof result.content === "string" ? result.content : (result.content ?? []).map(part => part.text ?? "").join("");
      return send(res, 200, reply([{ type: "text", text: fakeClaire(JSON.parse(read)) }]));
    }
    const conversations = system.includes("owner's email");
    const portrait = system.includes("Give the whole picture its language");
    if (conversations && control.conversationsDelayMs) await new Promise(resolve => setTimeout(resolve, control.conversationsDelayMs));
    const userText = (request.messages ?? [])
      .map(message => (typeof message.content === "string" ? message.content : (message.content ?? []).map(part => part.text ?? "").join("")))
      .join("\n");
    const answer = portrait ? fakePortrait(userText) : conversations ? extraction.conversations : extraction.work;
    modelCalls.push(portrait ? "portrait" : conversations ? "conversations" : "work");
    return send(res, 200, {
      id: `msg_fake_${modelCalls.length}`,
      type: "message",
      role: "assistant",
      model: request.model,
      content: [{ type: "text", text: JSON.stringify(answer) }],
      stop_reason: "end_turn",
      stop_sequence: null,
      usage: { input_tokens: 1200, output_tokens: 800 },
    });
  }
  if (path === "/__model-calls") return send(res, 200, { calls: modelCalls });

  // ---------------------------------------------------------------- Slack
  if (path === "/slack.com/oauth/v2/authorize") return consent(url, res, "fake-slack-code");
  if (path === "/slack.com/api/oauth.v2.access" && req.method === "POST") {
    const form = new URLSearchParams(body);
    if (form.get("code") !== "fake-slack-code") return send(res, 200, { ok: false, error: "invalid_code" });
    return send(res, 200, {
      ok: true,
      authed_user: { id: "UFAKE1", scope: "channels:read,channels:history,users:read,search:read", access_token: "xoxp-fake", token_type: "user" },
      team: { id: "TFAKE1", name: control.slackTeam },
    });
  }
  if (path === "/slack.com/api/auth.revoke" && req.method === "POST") {
    revoked.push({ provider: "slack" });
    return send(res, 200, { ok: true, revoked: true });
  }

  send(res, 404, `fake providers: nothing at ${path}`);
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`fake providers listening on http://127.0.0.1:${PORT}`);
});
