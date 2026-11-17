/**
 * Words in English letters (#340): the speech model sometimes writes Hindi or Bengali in its own script,
 * even when Hinglish or Banglish was asked for. Duet keeps every transcript in English letters, the way
 * people type these languages in messages: "मैं तो बता" becomes "main to bata", "আমি ভালো" becomes
 * "ami bhalo". A word already in English letters is left as it is.
 */

interface Script {
  consonants: Record<string, string>;
  vowels: Record<string, string>;
  signs: Record<string, string>;
  /** The vowel a consonant carries when nothing else is written. */
  inherent: string;
  virama: string;
  nukta: string;
  /** A consonant with a nukta, as it is said. */
  dotted: Record<string, string>;
  /** The nasal marks and the h at the end of a syllable. */
  nasal: string[];
  visarga: string;
}

const DEVANAGARI: Script = {
  consonants: {
    क: "k", ख: "kh", ग: "g", घ: "gh", ङ: "n", च: "ch", छ: "chh", ज: "j", झ: "jh", ञ: "n",
    ट: "t", ठ: "th", ड: "d", ढ: "dh", ण: "n", त: "t", थ: "th", द: "d", ध: "dh", न: "n",
    प: "p", फ: "ph", ब: "b", भ: "bh", म: "m", य: "y", र: "r", ल: "l", व: "w", श: "sh",
    ष: "sh", स: "s", ह: "h", क़: "q", ख़: "kh", ग़: "g", ज़: "z", ड़: "r", ढ़: "rh", फ़: "f", य़: "y",
  },
  vowels: { अ: "a", आ: "aa", इ: "i", ई: "ee", उ: "u", ऊ: "oo", ऋ: "ri", ए: "e", ऐ: "ai", ओ: "o", औ: "au", ऑ: "o", ऍ: "e" },
  signs: { "ा": "aa", "ि": "i", "ी": "ee", "ु": "u", "ू": "oo", "ृ": "ri", "े": "e", "ै": "ai", "ो": "o", "ौ": "au", "ॉ": "o", "ॅ": "e" },
  inherent: "a",
  virama: "्",
  nukta: "़",
  dotted: { क: "q", ख: "kh", ग: "g", ज: "z", ड: "r", ढ: "rh", फ: "f", य: "y" },
  nasal: ["ं", "ँ"],
  visarga: "ः",
};

const BENGALI: Script = {
  consonants: {
    ক: "k", খ: "kh", গ: "g", ঘ: "gh", ঙ: "ng", চ: "ch", ছ: "chh", জ: "j", ঝ: "jh", ঞ: "n",
    ট: "t", ঠ: "th", ড: "d", ঢ: "dh", ণ: "n", ত: "t", থ: "th", দ: "d", ধ: "dh", ন: "n",
    প: "p", ফ: "ph", ব: "b", ভ: "bh", ম: "m", য: "j", র: "r", ল: "l", শ: "sh", ষ: "sh",
    স: "s", হ: "h", ড়: "r", ঢ়: "rh", য়: "y", ৎ: "t",
  },
  vowels: { অ: "o", আ: "a", ই: "i", ঈ: "i", উ: "u", ঊ: "u", ঋ: "ri", এ: "e", ঐ: "oi", ও: "o", ঔ: "ou" },
  signs: { "া": "a", "ি": "i", "ী": "i", "ু": "u", "ূ": "u", "ৃ": "ri", "ে": "e", "ৈ": "oi", "ো": "o", "ৌ": "ou" },
  inherent: "o",
  virama: "্",
  nukta: "়",
  dotted: { ড: "r", ঢ: "rh", য: "y" },
  nasal: ["ং", "ঁ"],
  visarga: "ঃ",
};

const DIGITS: Record<string, string> = Object.fromEntries([..."०१२३४५६७८९"].map((d, i) => [d, String(i)]).concat([..."০১২৩৪৫৬৭৮৯"].map((d, i) => [d, String(i)])));

const scriptOf = (ch: string): Script | null => (/[ऀ-ॿ]/.test(ch) ? DEVANAGARI : /[ঀ-৿]/.test(ch) ? BENGALI : null);

/** One sound unit: a consonant (or none) and the vowel after it. `vowel` null means the inherent one. */
interface Unit {
  cons: string;
  vowel: string | null;
  /** Written with no vowel at all (a virama). */
  bare: boolean;
  /** n or h said after it. */
  tail: string;
}

/** A stretch of one script, in English letters. */
function romanRun(text: string, s: Script): string {
  const units: Unit[] = [];
  const chars = [...text.normalize("NFC")];
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    const last = units[units.length - 1];
    if (s.consonants[ch] !== undefined) {
      let cons = s.consonants[ch];
      if (chars[i + 1] === s.nukta && s.dotted[ch]) {
        cons = s.dotted[ch];
        i++;
      }
      units.push({ cons, vowel: null, bare: false, tail: "" });
    } else if (s.vowels[ch] !== undefined) units.push({ cons: "", vowel: s.vowels[ch], bare: false, tail: "" });
    else if (s.signs[ch] !== undefined && last) last.vowel = s.signs[ch];
    else if (ch === s.virama && last) last.bare = true;
    else if (s.nasal.includes(ch) && last) last.tail = "n";
    else if (ch === s.visarga && last) last.tail = "h";
    else if (ch === "।" || ch === "॥") units.push({ cons: ".", vowel: "", bare: true, tail: "" });
    else if (DIGITS[ch]) units.push({ cons: DIGITS[ch], vowel: "", bare: true, tail: "" });
  }
  // the inherent vowel is not said at the end of a word, nor between two said syllables (kar-ke, not kar-a-ke)
  const sayInherent = units.map((u) => u.vowel === null && !u.bare);
  for (let i = units.length - 1; i >= 0; i--) {
    if (!sayInherent[i] || units[i].tail) continue;
    const isLast = i === units.length - 1;
    const prevSaid = i > 0 && (units[i - 1].vowel !== null || sayInherent[i - 1]) && !units[i - 1].bare;
    const next = units[i + 1];
    const nextVoiced = !!next && !!next.cons && !next.bare && (next.vowel !== null || sayInherent[i + 1]);
    if (isLast && i > 0) sayInherent[i] = false;
    else if (!isLast && prevSaid && nextVoiced) sayInherent[i] = false;
  }
  let out = "";
  units.forEach((u, i) => {
    const end = i === units.length - 1;
    let v = u.bare ? "" : u.vowel ?? (sayInherent[i] ? s.inherent : "");
    // long vowels are written short at the end of a word, the way people type them: bata, nahi
    if (end) v = v === "aa" ? "a" : v === "ee" ? "i" : v === "oo" && !u.tail ? "u" : v;
    let tail = u.tail;
    // a nasal before p, b or m sounds like m
    if (tail === "n" && /^(p|b|m)/.test(units[i + 1]?.cons ?? "")) tail = "m";
    out += u.cons + v + tail;
  });
  return out;
}

/** A word or phrase in English letters. Letters already in English, and anything else, stay. */
export function inEnglishLetters(text: string): string {
  if (!/[ऀ-৿]/.test(text)) return text;
  let out = "";
  let run = "";
  let script: Script | null = null;
  const flush = () => {
    if (run && script) out += romanRun(run, script);
    run = "";
  };
  for (const ch of text) {
    const s = scriptOf(ch);
    if (s) {
      if (s !== script) flush();
      script = s;
      run += ch;
    } else {
      flush();
      script = null;
      out += ch;
    }
  }
  flush();
  return out;
}
