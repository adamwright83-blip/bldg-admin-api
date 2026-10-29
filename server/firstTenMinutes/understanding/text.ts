/**
 * Text helpers for the crew's reading. The rule they serve: a quote is shown only when it appears in the item it
 * cites, and what is shown is the item's own characters, never the model's copy of them.
 */

const FOLD: Array<[RegExp, string]> = [
  [/[‘’‛′]/g, "'"],
  [/[“”‟″]/g, '"'],
  [/[–—−]/g, "-"],
  [/…/g, "..."],
  [/ /g, " "],
];

/** Fold typography and case so a faithful quote matches its source; one output character per input character. */
function foldChar(char: string): string {
  let out = char;
  for (const [pattern, replacement] of FOLD) out = out.replace(pattern, replacement);
  return out.length === 1 ? out.toLowerCase() : char.toLowerCase();
}

/**
 * The span of `source` that `quote` copies, ignoring differences in whitespace, curly quotes, dashes and case.
 * Returns the source's own text for that span, or null when the quote isn't in the source.
 */
export function findVerbatim(source: string, quote: string): string | null {
  const wanted = quote.trim();
  if (wanted.length < 3) return null;
  // Normalised source with a map back to original offsets.
  const chars: string[] = [];
  const offsets: number[] = [];
  let lastWasSpace = true;
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    if (/\s/.test(char)) {
      if (!lastWasSpace) {
        chars.push(" ");
        offsets.push(i);
      }
      lastWasSpace = true;
      continue;
    }
    chars.push(foldChar(char));
    offsets.push(i);
    lastWasSpace = false;
  }
  const haystack = chars.join("");
  const needle = Array.from(wanted.replace(/\s+/g, " "))
    .map(foldChar)
    .join("");
  const at = haystack.indexOf(needle);
  if (at < 0) return null;
  const start = offsets[at];
  const end = offsets[at + needle.length - 1] + 1;
  return source.slice(start, end);
}

/** Drop quoted history ("On … wrote:" and "> " lines) so a reply is read as what the person wrote. */
export function stripQuotedReply(body: string): string {
  const lines = body.replace(/\r\n/g, "\n").split("\n");
  const kept: string[] = [];
  for (const line of lines) {
    if (/^On .{4,200}wrote:\s*$/.test(line.trim())) break;
    if (/^-{2,}\s*Original Message\s*-{2,}/i.test(line.trim())) break;
    if (/^From: .+/.test(line.trim()) && kept.length > 2) break;
    if (line.trim().startsWith(">")) continue;
    kept.push(line);
  }
  return kept.join("\n").trim();
}

/** Plain text from an HTML email body. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Cut to at most `max` characters at a word boundary. */
export function clip(text: string, max: number): string {
  const flat = text.trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return `${cut.slice(0, space > max * 0.6 ? space : max).trim()}…`;
}

const SIGN_OFF = /^(thanks|thank you|best|cheers|warmly|regards|kind regards|best regards|love|x+|sent from my \w+)[,.!]*$/i;

/**
 * The person's own last sentence before the sign-off and signature: what they ended the message with.
 * A signature is the short lines after the last paragraph that reads like writing.
 */
export function closingSentence(body: string): string | null {
  const paragraphs = stripQuotedReply(body)
    .split(/\n\s*\n/)
    .map(paragraph => paragraph.trim())
    .filter(Boolean);
  for (let i = paragraphs.length - 1; i >= 0; i -= 1) {
    const paragraph = paragraphs[i];
    const lines = paragraph.split("\n").map(line => line.trim()).filter(Boolean);
    const reads = lines.some(line => /[.?!]["')\]]?$/.test(line) && line.split(/\s+/).length >= 3);
    if (!reads) continue;
    // the last line that reads like a sentence, ignoring sign-offs below it
    const writing = lines.filter(line => !SIGN_OFF.test(line));
    const last = [...writing].reverse().find(line => /[.?!]["')\]]?$/.test(line));
    if (!last) continue;
    const sentences = last.match(/[^.?!]+[.?!]+["')\]]?/g) ?? [last];
    return sentences[sentences.length - 1].trim();
  }
  return null;
}

/** Two addresses are the same mailbox. */
export function sameAddress(a: string | null | undefined, b: string | null | undefined): boolean {
  return Boolean(a && b && a.trim().toLowerCase() === b.trim().toLowerCase());
}

/** "elena@larkspurhotel.example" from "Elena Ruiz <elena@larkspurhotel.example>". */
export function parseAddressList(value: string | null | undefined): Array<{ name: string | null; email: string }> {
  if (!value) return [];
  const out: Array<{ name: string | null; email: string }> = [];
  for (const part of value.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/)) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const angle = trimmed.match(/^(.*)<([^>]+)>$/);
    if (angle) {
      const name = angle[1].trim().replace(/^"|"$/g, "").trim();
      out.push({ name: name || null, email: angle[2].trim().toLowerCase() });
    } else if (trimmed.includes("@")) {
      out.push({ name: null, email: trimmed.toLowerCase() });
    }
  }
  return out;
}

/** Mail no person wrote: notifications, newsletters, receipts. */
export function looksAutomated(input: { from: string; listUnsubscribe?: boolean; subject?: string }): boolean {
  if (input.listUnsubscribe) return true;
  return /(^|[._-])(no-?reply|do-?not-?reply|notifications?|mailer-daemon|bounce|news(letter)?|updates?|receipts?|billing|support)@/i.test(
    input.from
  );
}
