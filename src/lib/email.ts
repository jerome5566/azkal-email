/* Email normalisation, classification and merge-field handling. */

export type ProviderType =
  | "gmail"
  | "outlook"
  | "yahoo"
  | "other_free"
  | "company"
  | "unknown";

/* Domains treated as the same mailbox provider. */
const GMAIL = new Set(["gmail.com", "googlemail.com"]);
const OUTLOOK = new Set([
  "outlook.com", "hotmail.com", "live.com", "msn.com",
  "outlook.co.uk", "hotmail.co.uk", "live.co.uk", "hotmail.fr",
  "outlook.ae", "hotmail.ae",
]);
const YAHOO = new Set([
  "yahoo.com", "ymail.com", "rocketmail.com",
  "yahoo.co.uk", "yahoo.co.in", "yahoo.ae", "yahoo.fr", "yahoo.de",
]);
const OTHER_FREE = new Set([
  "aol.com", "icloud.com", "me.com", "mac.com", "proton.me", "protonmail.com",
  "gmx.com", "gmx.net", "mail.com", "yandex.com", "yandex.ru", "zoho.com",
  "rediffmail.com", "mail.ru", "inbox.com", "fastmail.com", "tutanota.com",
  "eim.ae", "emirates.net.ae",
]);

/* Mailboxes that belong to a function rather than a person. Higher complaint
   rates and a common home for spam traps, so they are flagged and filterable. */
const ROLE_PREFIXES = new Set([
  "info", "sales", "admin", "contact", "support", "help", "office", "enquiry",
  "enquiries", "inquiry", "inquiries", "hello", "hi", "team", "mail", "email",
  "marketing", "hr", "careers", "jobs", "accounts", "accounting", "finance",
  "billing", "invoice", "noreply", "no-reply", "donotreply", "postmaster",
  "webmaster", "abuse", "reception", "general", "listings", "leasing", "rent",
  "property", "properties", "customerservice", "service", "booking", "bookings",
]);

/* Throwaway providers. Never worth sending to. */
const DISPOSABLE = new Set([
  "mailinator.com", "guerrillamail.com", "10minutemail.com", "tempmail.com",
  "throwawaymail.com", "yopmail.com", "trashmail.com", "sharklasers.com",
  "getnada.com", "temp-mail.org", "dispostable.com", "maildrop.cc",
]);

/* RFC-pragmatic. Deliberately not the full RFC 5322 grammar, which accepts
   plenty of things no real mail server will take. */
const EMAIL_RE =
  /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,}$/;

export interface ParsedEmail {
  raw: string;
  normalized: string;
  localPart: string;
  domain: string;
  providerType: ProviderType;
  isRoleAccount: boolean;
  isDisposable: boolean;
}

export function isValidEmailFormat(input: string): boolean {
  const v = input.trim();
  if (v.length === 0 || v.length > 254) return false;
  if (!EMAIL_RE.test(v)) return false;
  const [local] = v.split("@");
  if (local.length > 64) return false;
  return true;
}

export function classifyDomain(domain: string): ProviderType {
  const d = domain.toLowerCase();
  if (GMAIL.has(d)) return "gmail";
  if (OUTLOOK.has(d)) return "outlook";
  if (YAHOO.has(d)) return "yahoo";
  if (OTHER_FREE.has(d)) return "other_free";
  if (d.includes(".")) return "company";
  return "unknown";
}

/**
 * Normalise an address to a canonical mailbox key.
 *
 * Always: trim, lowercase, strip surrounding quotes and mailto:.
 * Gmail only: strip dots and everything after a plus, because Gmail genuinely
 * routes john.doe+x@gmail.com and johndoe@gmail.com to the same inbox. Applying
 * this to other providers would be wrong, since for most of them dots are
 * significant.
 *
 * The raw form is kept and is what we actually send to.
 */
export function parseEmail(input: string): ParsedEmail | null {
  let raw = String(input ?? "").trim();
  if (!raw) return null;

  raw = raw.replace(/^mailto:/i, "").replace(/^["'<]+|["'>]+$/g, "").trim();
  // Some registry exports pack several addresses into one cell.
  if (/[,;|]/.test(raw)) raw = raw.split(/[,;|]/)[0].trim();
  if (!isValidEmailFormat(raw)) return null;

  const atIndex = raw.lastIndexOf("@");
  const localRaw = raw.slice(0, atIndex);
  const domain = raw.slice(atIndex + 1).toLowerCase();

  let localNorm = localRaw.toLowerCase();
  const provider = classifyDomain(domain);

  if (provider === "gmail") {
    localNorm = localNorm.split("+")[0].replace(/\./g, "");
  } else {
    localNorm = localNorm.split("+")[0];
  }

  const canonicalDomain = GMAIL.has(domain) ? "gmail.com" : domain;
  const basePrefix = localNorm.replace(/[._-]/g, "");

  return {
    raw,
    normalized: `${localNorm}@${canonicalDomain}`,
    localPart: localRaw,
    domain,
    providerType: provider,
    isRoleAccount: ROLE_PREFIXES.has(localNorm) || ROLE_PREFIXES.has(basePrefix),
    isDisposable: DISPOSABLE.has(domain),
  };
}

/* --------------------------------------------------------- merge fields */

export const MERGE_FIELD_RE = /\{\{\s*([a-z_][a-z0-9_]*)\s*\}\}/gi;

export function extractMergeFields(text: string): string[] {
  const found = new Set<string>();
  for (const m of text.matchAll(MERGE_FIELD_RE)) found.add(m[1].toLowerCase());
  return [...found];
}

/**
 * Render a template. Returns the missing field names rather than silently
 * producing "Hi ," which is the failure mode the brief calls out.
 */
export function renderTemplate(
  text: string,
  data: Record<string, string | null | undefined>
): { output: string; missing: string[] } {
  const missing = new Set<string>();
  const output = text.replace(MERGE_FIELD_RE, (_m, key: string) => {
    const k = key.toLowerCase();
    const v = data[k];
    if (v === undefined || v === null || String(v).trim() === "") {
      missing.add(k);
      return `{{${k}}}`;
    }
    return String(v).trim();
  });
  return { output, missing: [...missing] };
}

/* Turn "AHMED  AL-MANSOURI" into "Ahmed", which is what a greeting needs. */
export function firstNameFrom(fullName: string | null | undefined): string | null {
  if (!fullName) return null;
  const cleaned = fullName.replace(/\s+/g, " ").trim();
  if (!cleaned) return null;
  const skip = new Set(["mr", "mrs", "ms", "dr", "eng", "mr.", "mrs.", "ms.", "dr."]);
  for (const part of cleaned.split(" ")) {
    if (skip.has(part.toLowerCase())) continue;
    if (part.length < 2) continue;
    if (!/[a-z]/i.test(part)) continue;
    return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
  }
  return null;
}

/* Company suffixes and abbreviations common in UAE trade names. These stay
   uppercase, because "Prime Properties L.l.c" reads as a bug to the recipient. */
const KEEP_UPPER = new Set([
  "LLC", "L.L.C", "L.L.C.", "FZE", "FZC", "FZ-LLC", "FZLLC", "DMCC", "JLT",
  "LTD", "PJSC", "PSC", "WLL", "SPC", "DWC", "DIFC", "RAK", "RAKEZ",
  "UAE", "DXB", "AE", "PO", "JVC", "JBR", "TECOM", "AI", "IT", "HR",
]);

export function titleCase(s: string | null | undefined): string | null {
  if (!s) return null;
  return s
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .map((w) => {
      const bare = w.replace(/[.,]/g, "").toUpperCase();
      if (KEEP_UPPER.has(w.toUpperCase()) || KEEP_UPPER.has(bare)) return w.toUpperCase();
      // A short all-caps token with no vowels is almost always an acronym.
      if (w.length <= 4 && w === w.toUpperCase() && !/[AEIOU]/i.test(w.replace(/[^A-Z]/gi, ""))) {
        return w.toUpperCase();
      }
      // Everything else, including Arabic name particles like Al and Bin.
      return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
    })
    .join(" ");
}
