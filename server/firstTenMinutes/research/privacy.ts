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
  { pattern: /\b(?:password|passcode|pin|passwd|secret|api[ _-]?key)\s*[:=]\s*\S+/gi },
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
  const title = name.toLowerCase();
  const body = sample.toLowerCase().slice(0, 4000);
  if (/\b(bank statement|personal (?:budget|finances?|banking)|my (?:budget|finances|accounts)|household budget|credit report)\b/.test(title)) {
    return "personal_finance";
  }
  if (/\b(tax return|w-?2|1040|passport|driver'?s licen[cs]e|medical|prescription|health record|insurance claim)\b/.test(title)) {
    return "personal_records";
  }
  if (/\b(passwords?|logins?|credentials)\b/.test(title)) return "credentials";
  const bankingWords = (body.match(/\b(routing number|account number|checking|savings|balance|deposit|withdrawal|overdraft)\b/g) ?? []).length;
  if (bankingWords >= 3 && /\b(personal|my|household|joint)\b/.test(`${title} ${body}`)) return "personal_finance";
  return null;
}
