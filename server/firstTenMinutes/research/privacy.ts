/**
 * What research may never carry forward: personal banking and identity numbers, credentials, and whole documents
 * that are about the person's private finances or health rather than their work.
 *
 * Applied to every snippet, passage and cell before it reaches a model, a log or the knowledge store. A redaction is
 * a fixed token, so nothing about the original value (its length, its last digits) survives.
 */

export const REDACTED = "[redacted]";

/** Luhn, so an ordinary long reference number isn't mistaken for a card. */
function luhn(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let value = Number(digits[i]);
    if (double) {
      value *= 2;
      if (value > 9) value -= 9;
    }
    sum += value;
    double = !double;
  }
  return sum % 10 === 0;
}

/**
 * Secrets by their issuers' formats: Anthropic, OpenAI, xAI, Stripe, Google (API keys, OAuth tokens and client
 * secrets), GitHub, Slack, AWS, JSON web tokens and private keys. Each must start a word, so "task-management-…" is
 * never mistaken for an "sk-" key.
 */
const RAW_SECRET =
  /(?<![A-Za-z0-9_-])(?:sk-ant-[A-Za-z0-9_-]{16,}|sk-(?:proj-)?[A-Za-z0-9_-]{32,}|xai-[A-Za-z0-9]{20,}|(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}|whsec_[A-Za-z0-9]{16,}|AIza[0-9A-Za-z_-]{30,}|ya29\.[0-9A-Za-z_-]{20,}|GOCSPX-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|xox[abprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}|-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$))/g;

/** Whether the text holds a secret in one of its issuers' formats. */
export function holdsRawSecret(text: string): boolean {
  RAW_SECRET.lastIndex = 0;
  const found = RAW_SECRET.test(text);
  RAW_SECRET.lastIndex = 0;
  return found;
}

const RULES: Array<{ pattern: RegExp; keep?: (match: string) => boolean }> = [
  // card numbers: 13-19 digits, optionally grouped by spaces or dashes, that pass Luhn
  { pattern: /\b(?:\d[ -]?){12,18}\d\b/g, keep: match => !luhn(match.replace(/\D/g, "")) },
  // US social security numbers
  { pattern: /\b\d{3}-\d{2}-\d{4}\b/g },
  // IBAN
  { pattern: /\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]{4}){3,7}(?:[ ]?[A-Z0-9]{1,3})?\b/g },
  // a number labelled as a bank account, routing / ABA / sort code, or card
  {
    pattern:
      /\b(?:account|acct|a\/c|routing|aba|sort code|checking|savings|card|iban|swift|bic)(?:\s*(?:no\.?|number|num|#))?\s*[:#-]?\s*[A-Z0-9][A-Z0-9 -]{3,24}\d\b/gi,
  },
  // credentials written out
  { pattern: /\b(?:password|passcode|pin|passwd|secret|api[ _-]?key|token|client[ _-]?secret)\s*[:=]\s*\S+/gi },
  // credentials pasted bare, recognised by their issuers' formats (a person keeps keys in a doc without labelling them)
  { pattern: RAW_SECRET },
  // a password inside a connection URL: scheme://user:password@host
  { pattern: /\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:[^\s@/]+@/gi },
];

/** The text with personal financial and identity numbers and written-out credentials replaced. */
export function redactSensitive(text: string): string {
  let out = text;
  for (const rule of RULES) {
    out = out.replace(rule.pattern, match => (rule.keep?.(match) ? match : REDACTED));
  }
  return out;
}

/** Spreadsheet headings whose whole column is never read. */
const SENSITIVE_HEADER =
  /\b(account (?:no|number|#)|acct|routing|aba|iban|swift|sort code|card (?:no|number)|cvv|cvc|ssn|social security|tax id|passport|password|pin|login|dob|date of birth|medical|diagnosis)\b/i;

export function sensitiveHeader(header: string): boolean {
  return SENSITIVE_HEADER.test(header);
}

/**
 * Why a whole document is left out of business research, or null when it may be read. Decided from its name and,
 * when known, its headings or opening text: a bank statement, a personal budget, a tax return, medical records.
 * A business's own books ("Laundry P&L", "Invoices 2026") are business evidence and are not excluded here.
 */
export function sensitiveDocumentReason(name: string, sample = ""): string | null {
  // "Claire_Test_api_key" is as much a key file as "API key": underscores and dashes separate words in file names
  const title = name.toLowerCase().replace(/[_-]+/g, " ");
  const body = sample.toLowerCase().slice(0, 4000);
  if (/\b(bank statement|personal (?:budget|finances?|banking)|my (?:budget|finances|accounts)|household budget|credit report)\b/.test(title)) {
    return "personal_finance";
  }
  if (/\b(tax return|w-?2|1040|passport|driver'?s licen[cs]e|medical|prescription|health record|insurance claim)\b/.test(title)) {
    return "personal_records";
  }
  if (/\b(passwords?|logins?|credentials?|api ?keys?|secret keys?|private keys?|(?:access|auth|api|bearer) tokens?|keys? rotation)\b/.test(title)) return "credentials";
  // a document with a bare key in it is a credentials document, whatever it's called: never read, never quoted
  if (holdsRawSecret(sample)) return "credentials";
  const bankingWords = (body.match(/\b(routing number|account number|checking|savings|balance|deposit|withdrawal|overdraft)\b/g) ?? []).length;
  if (bankingWords >= 3 && /\b(personal|my|household|joint)\b/.test(`${title} ${body}`)) return "personal_finance";
  return null;
}
