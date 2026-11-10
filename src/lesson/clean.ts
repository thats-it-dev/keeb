// The rules that decide whether a word may appear in a lesson. Two callers share them, which is the whole
// reason this file exists: `scripts/make-corpus.ts` uses them to filter the frequency dump, and the word
// generator uses them to reject what its n-gram model invents. Cleaning the training data is not enough,
// because a probabilistic model can spell a word nobody trained it to intend.
//
// Build-time-only lists (the proper nouns in the source dump) live in `scripts/blocklists.ts`: a generated
// word is never someone's name, and the browser has no business carrying a thousand of them.

/**
 * Substrings, matched against the whole word. Every one is unambiguous — no ordinary English word contains
 * it. Anything that collides with real vocabulary is in `BLOCKED` as a whole word instead.
 */
export const BLOCKED_ROOTS: readonly string[] = [
	"fuck", "shit", "bitch", "bollock", "wank", "twat", "piss", "whore", "slut", "asshole", "jackass",
	"badass", "dumbass", "nigg", "fagg", "kike", "spick", "gook", "tranny", "shemale", "porn", "xxx",
	"dildo", "vibrator", "masturbat", "orgasm", "ejaculat", "cumshot", "cummin", "penis", "vagina",
	"testic", "vulva", "pubic", "buttplug", "rapist", "molest", "pedophi", "nudity", "erotic", "obscene",
	"retard", "pervert", "goddamn", "motherfuck", "wtf", "lmao", "omg",
];

/**
 * Whole words, because these strings are also parts of honest vocabulary: `ass` lives inside "class",
 * `cock` inside "peacock", `cum` inside "cumulative", `crap` inside "scrap", `tit` inside "title", `rape`
 * inside "grape", `damn` inside? no — that one is a root. This list is the collision cases, plus the
 * short mild ones not worth a root.
 */
export const BLOCKED: ReadonlySet<string> = new Set([
	"ass", "asses", "bastard", "cock", "cocks", "cum", "cums", "damn", "damned", "damnit", "dick",
	"dicks", "dingus", "dipshit", "crap", "crappy", "fag", "fags", "jerkoff", "prick", "pricks", "pussy",
	"arse", "arses", "arsy",
	"tit", "tits", "knob", "nonce", "anus", "boob", "boobs", "pee", "poop", "poopy", "sex", "sexual",
	"sexually", "sexy", "nude", "nudes", "genital", "genitals", "nipple", "nipples", "rape", "raped",
	"raping", "spic", "coon", "chink", "gyp", "retarded", "lol", "brb", "imo", "imho", "smh", "nvm",
	"idk", "tbh", "fyi", "ttyl", "ftw", "asf", "sheesh", "dipstick", "bellend", "git",
]);

/**
 * Filler the subtitle source counts as vocabulary. These are also the strings a letter model most easily
 * invents, because they are short and built from the first six letters.
 */
export const FILLER: ReadonlySet<string> = new Set([
	"oh", "ah", "aha", "ahh", "aii", "aw", "aww", "ay", "eh", "heh", "hey", "hah", "haha", "hmm", "hmmm",
	"hm", "hum", "huh", "ick", "ohh", "ooh", "oooh", "oops", "ow", "oww", "ouch", "psst", "shh", "sigh",
	"tsk", "ugh", "uh", "uhh", "uhuh", "um", "umm", "wat", "whoa", "whoo", "whew", "wow", "yuck", "yum",
	"yummy", "yikes", "gee", "gosh", "jeez", "jeezus", "yeesh", "grr", "argh", "mmm", "meh", "mhm", "nah",
	"nope", "yep", "yeah", "yo", "ok", "okay", "okey", "kk", "hush", "ta", "cheerio", "toodlepip",
]);

/**
 * What is left of a contraction once the dump's tokenizer dropped the apostrophe, plus the g-dropping
 * forms and the typos the same dump carries. The `-ing`-without-the-g case is covered structurally by
 * `droppedGerund`; this list is everything else.
 */
export const FRAGMENTS: ReadonlySet<string> = new Set([
	"don", "dont", "doesn", "didn", "isn", "wasn", "weren", "aren", "wouldn", "couldn", "shouldn",
	"hasn", "hadn", "haven", "mustn", "ain", "won", "cant", "wont", "gon", "lets", "thats", "youre",
	"theyre", "weve", "ive", "id", "ill", "im", "ve", "ll", "re", "em", "cos", "coz", "cuz", "de", "el",
	"li", "la", "le", "da", "pa", "jo", "ma", "al", "ad", "ex", "bo", "fu", "ii", "oi", "ye", "ya",
	"sans", "chan", "kun", "von", "herr", "jin", "pos", "iike", "teh", "bro", "sis", "dude", "dudes",
	"mate", "mates", "buddy", "pal", "folks", "fellas", "fella", "kinda", "sorta", "wanna", "gonna",
	"gotta", "outta", "lemme", "dunno", "sez", "cus", "ainit", "innit",
]);

/** Words of two letters that are real function words. Every other two-letter entry in the dump is a
 *  fragment (`id`, `ve`, `em`) or filler (`oh`, `hi`, `ok`), so length 2 is otherwise a reject. */
export const SHORT_WORDS: ReadonlySet<string> = new Set([
	"am", "an", "as", "at", "be", "by", "do", "go", "he", "if", "in", "is", "it", "me", "my", "no",
	"of", "on", "or", "so", "to", "up", "us", "we",
]);

/** A g-dropped gerund: the dump holds "doin" next to "doing". `all` is the candidate set, so the rule can
 *  check the full form exists rather than guessing from spelling. */
export function droppedGerund(word: string, all: ReadonlySet<string>): boolean {
	return word.length > 3 && word.endsWith("in") && all.has(`${word}g`);
}

/** True when this word may be trained on, quoted from the corpus, or invented by the model. */
export function isCleanWord(word: string): boolean {
	if (!/^[a-z]+$/.test(word)) return false;
	if (!/[aeiouy]/.test(word)) return false;
	if (word.length < 3 && !SHORT_WORDS.has(word)) return false;
	if (BLOCKED.has(word) || FILLER.has(word) || FRAGMENTS.has(word)) return false;
	for (const root of BLOCKED_ROOTS) if (word.includes(root)) return false;
	return true;
}
