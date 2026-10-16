/**
 * Public display names must be clean: this is a simple word-list filter on a normalised form of the name
 * (case, accents, look-alike digits/symbols, separators and repeated letters are folded away), plus a ban on
 * contact details and on names that pose as FORM staff or as an anonymous "Athlete #code". It runs when a name
 * is saved (reject with a clear message) and again when a name is read for the leaderboard (a safety net, so
 * a name saved before a word was added never appears).
 */

/** Terms refused anywhere inside the name (long or unusual enough that an innocent word rarely contains them). */
const BLOCKED_SUBSTRINGS = [
  "fuck", "shit", "bitch", "cunt", "whore", "slut", "dick", "penis", "vagina", "asshole", "bastard", "nigg", "fagg", "retard", "tranny",
  "chink", "wetback", "hitler", "rapist", "molest", "porn", "terror", "suicide", "blowjob", "handjob", "orgasm", "dildo",
] as const;

/** Short or common-inside-other-words terms, refused only as a whole word (so "Essex" or "cucumber" stay fine). */
const BLOCKED_WORDS = [
  "arse", "damn", "crap", "piss", "fag", "dyke", "homo", "tit", "tits", "wank", "twat", "hoe", "rape", "nazi", "kkk", "isis", "jihad",
  "pedo", "paedo", "sex", "xxx", "nude", "cum", "boob", "boobs", "anal", "cock", "coon", "paki", "spic", "kike", "gook", "kill", "negro",
] as const;

/** Names that pose as the product or its staff. */
const RESERVED = ["admin", "administrator", "moderator", "support", "staff", "official", "formapp", "formteam", "system"] as const;

const LOOKALIKES: Record<string, string> = { "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "8": "b", "9": "g", "@": "a", $: "s", "!": "i", "|": "i", "+": "t" };

/** Lower-case, accents removed, look-alike characters mapped to letters. Word breaks are kept as single spaces. */
function fold(name: string): string {
  const base = name.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();
  let out = "";
  for (const ch of base) out += LOOKALIKES[ch] ?? ch;
  return out.replace(/[^a-z]+/g, " ").trim();
}

/** Repeated letters collapsed ("fuuuck" becomes "fuck"). */
const squash = (s: string) => s.replace(/(.)\1+/g, "$1");

/** Why a public name is refused, or null when it is fine. */
export function publicNameProblem(raw: string, maxLength = 40): string | null {
  const name = raw.trim();
  if (name.length === 0) return "Enter a name.";
  if (name.length > maxLength) return `Keep it to ${maxLength} characters or fewer.`;
  // eslint-disable-next-line no-control-regex -- control and zero-width characters can hide a word
  if (/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁠﻿]/.test(name)) return "That name has characters we can't show.";
  if (/https?:|www\.|\.(com|net|org|io|app|me|co|ly)\b|@/i.test(name) || /(\d[\s\-.()]*){7}/.test(name)) {
    return "Leave out links, emails and phone numbers.";
  }
  const folded = fold(name);
  const parts = folded.split(" ");
  const joined = parts.join("");
  const squashed = squash(joined);
  // Whole-word match, also with stretched letters ("fuuuck") unless squashing would turn the term into a real short word ("kkk" -> "k").
  const wordHit = (term: string) => parts.some((w) => w === term || (squash(term).length >= 3 && squash(w) === squash(term)));
  const substringHit = (term: string) => {
    const t = squash(term);
    // A squashed term under 4 letters ("nigg" -> "nig") would match innocent names such as Nigel; those are only checked unsquashed.
    return joined.includes(term) || (t.length >= 4 && squashed.includes(t));
  };
  // "ass" squashes to a real word ("as"), so it has its own pattern: an a, then two or more s.
  const assHit = parts.some((w) => /^a+s{2,}$/.test(w));
  if (assHit || BLOCKED_SUBSTRINGS.some(substringHit) || BLOCKED_WORDS.some(wordHit)) {
    return "That name isn't allowed. Pick something friendlier.";
  }
  if (RESERVED.some((w) => squashed === squash(w) || parts.some((p) => squash(p) === squash(w))) || /^athlete\s*#?\s*[a-z0-9]*$/i.test(name)) {
    return "That name is reserved. Pick another.";
  }
  return null;
}

/** The name to show publicly, or null when it must not be shown (empty, too long or filtered). */
export function safePublicName(raw: string | null | undefined, maxLength = 40): string | null {
  if (!raw) return null;
  const name = raw.trim().replace(/\s+/g, " ");
  return publicNameProblem(name, maxLength) === null ? name : null;
}
