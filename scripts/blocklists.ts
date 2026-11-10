// Rejection lists for scripts/make-corpus.ts. Build-time only: they are never imported by the app,
// because a word the corpus cannot contain is also a word the letter model cannot produce.
//
// How they were made, so they can be extended honestly: the frequency dump is OpenSubtitles text, and it
// carries every character name and city in every show ever subtitled. Each candidate word was compared
// against a case-sensitive English dictionary (/usr/share/dict/words from wamerican). A word the dictionary
// has only in its capitalised form is a proper noun; a word it does not have in either form is not English.
// The two lists below are those two answers, minus the vocabulary in KEEP that a learner still has to be
// able to type. Re-run the comparison after raising MAX_WORDS, or a fresh name walks in from deeper in the
// dump: see docs/spec.md, "Keeping the words clean".

/** Person, character, place and brand names in the source dump. */
export const NAMES: readonly string[] = [
	"aaron", "abby", "adam", "adams", "adrian", "afghanistan", "africa", "al", "alan", "albert", "alex", "alexander",
	"alfred", "ali", "alice", "alicia", "alison", "allen", "allison", "amanda", "amy", "ana",
	"anderson", "andre", "andrea", "andrew", "andy", "angela", "angeles", "angie", "ann", "anna", "anne", "annie",
	"anthony", "antonio", "arnold", "arthur", "ashley", "asia", "asian", "atlantic", "audrey", "austin", "australia", "ba",
	"bailey", "barbara", "barry", "bart", "batman", "becky", "ben", "benjamin", "benny", "berlin", "bernard", "beth",
	"betty", "beverly", "blair", "blake", "boris", "boston", "boyd", "brandon", "brazil", "brenda", "brian", "britain",
	"broadway", "brooke", "brooklyn", "bruce", "bruno", "buddha", "burke", "burt", "caesar", "caleb", "california", "cameron",
	"campbell", "canada", "carl", "carla", "carlos", "carmen", "caroline", "carrie", "carson", "carter", "casey", "cassie",
	"catherine", "cathy", "cd", "chan", "chang", "charles", "charlie", "charlotte", "chen", "chicago", "chloe", "chris",
	"christ", "christina", "christine", "christopher", "cindy", "claire", "clara", "clark", "claudia", "claus", "cleveland", "clyde",
	"cole", "colin", "collins", "connie", "craig", "cuba", "curtis", "dallas", "damon", "dan", "dana", "daniel",
	"danny", "daphne", "dave", "david", "davis", "dawson", "debbie", "dee", "del", "denise", "dennis", "denny",
	"derek", "di", "diana", "diane", "diego", "donald", "donna", "dorothy", "doug", "douglas", "doyle", "dr",
	"duncan", "dylan", "eddie", "edgar", "edward", "egypt", "elaine", "elena", "eli", "elizabeth", "ellen", "ellie",
	"elliot", "elvis", "emily", "emma", "england", "er", "eric", "erica", "ethan", "europe", "eva", "evan",
	"excellency", "felix", "finn", "fiona", "florence", "florida", "france", "francis", "francisco", "frankie", "franklin", "fred",
	"freddie", "freddy", "gabriel", "gary", "george", "georgia", "germany", "gibbs", "gina", "glenn", "gloria", "gordon",
	"graham", "greg", "gus", "gwen", "hal", "han", "hannah", "hans", "harold", "harper", "harris", "harrison",
	"harvard", "harvey", "hawaii", "helen", "henry", "hercules", "hitler", "hollywood", "holmes", "hon", "hong", "houston",
	"howard", "hugo", "ian", "india", "iraq", "irene", "isaac", "isabel", "israel", "italy", "ivan", "jackie",
	"jackson", "jacob", "jake", "james", "jamie", "jan", "jane", "janet", "jason", "jean", "jeff", "jeffrey",
	"jenna", "jennifer", "jenny", "jeremy", "jerry", "jess", "jesse", "jessica", "jessie", "jesus", "jew", "jews",
	"jill", "jim", "jo", "joan", "joe", "joel", "joey", "johnny", "johnson", "jon", "jonas", "jonathan",
	"jones", "jordan", "joseph", "jr", "juan", "judy", "jules", "julia", "julian", "julie", "juliet", "jung",
	"justin", "karen", "karl", "kate", "katherine", "kathy", "katie", "kay", "keith", "kelly", "kennedy", "kenny",
	"kent", "kevin", "kim", "kirk", "kong", "korea", "kurt", "kyle", "lana", "larry", "las", "laura",
	"lauren", "lawrence", "le", "lena", "lenny", "leo", "leon", "leonard", "leslie", "lester", "lewis", "li",
	"lin", "lincoln", "linda", "lindsay", "lisa", "liz", "lloyd", "ln", "logan", "lois", "lola", "london",
	"los", "lou", "louie", "louis", "louise", "lt", "lucas", "lucy", "luis", "luke", "lydia", "mac",
	"madison", "mafia", "maggie", "malcolm", "mandy", "manhattan", "marco", "marcus", "margaret", "marie", "marilyn", "mario",
	"marshall", "martha", "marty", "mary", "matthew", "maurice", "maya", "megan", "mel", "melissa", "mercedes", "meredith",
	"mexico", "mia", "miami", "michael", "michelle", "mick", "miguel", "milan", "ming", "miranda", "mitch", "mitchell",
	"molly", "mona", "monica", "morgan", "morris", "moscow", "mr", "mrs", "mulder", "murphy", "murray", "na",
	"nancy", "naomi", "natalie", "nate", "nathan", "nazi", "neal", "ned", "neil", "nelson", "nicholas", "nicole",
	"nigel", "nikki", "nina", "noah", "nora", "norman", "oliver", "olivia", "orleans", "oscar", "otto", "owen",
	"paige", "palmer", "pam", "paris", "parker", "patrick", "paul", "paula", "pedro", "peggy", "perry", "pete",
	"phil", "philip", "phillip", "pierre", "pm", "quinn", "rachel", "ralph", "raymond", "rebecca", "reggie", "rex",
	"richard", "richie", "ricky", "riley", "rita", "robbie", "robert", "roberts", "rodney", "rome", "romeo", "ron",
	"ronnie", "rory", "rosa", "rosie", "ross", "roy", "russell", "russia", "ruth", "ryan", "sabrina", "sam",
	"samantha", "sammy", "samuel", "san", "sandra", "santa", "sara", "sarah", "sasha", "satan", "scotland", "scott",
	"se", "sean", "seattle", "sebastian", "seth", "shakespeare", "shane", "sharon", "shaw", "shawn", "sheila", "shirley",
	"si", "sid", "simon", "simpson", "singh", "sophie", "spain", "spencer", "st", "stan", "stanley", "stefan",
	"stella", "stephen", "steve", "steven", "stuart", "susan", "sydney", "sylvia", "ta", "tanya", "tara", "taylor",
	"ted", "teddy", "teresa", "tess", "texas", "th", "thomas", "thompson", "tim", "tina", "toby", "todd",
	"tokyo", "tommy", "tracy", "travis", "trevor", "ty", "tyler", "val", "valerie", "vanessa", "vegas", "vera",
	"veronica", "vic", "vicky", "victoria", "vienna", "vietnam", "vince", "vincent", "virginia", "wallace", "walt", "walter",
	"wang", "washington", "watson", "wayne", "wendy", "william", "williams", "willie", "willy", "wilson", "winston", "wong",
	"wu", "wyatt", "yang", "york", "zoe",
];

/** Fragments, interjections, typos and abbreviations: in the dump, not in the language. */
export const NOT_WORDS: readonly string[] = [
	"aah", "ahh", "aii", "ain", "anyways", "aren", "argh", "arse", "auntie", "aunty", "bam", "bloke",
	"bo", "bon", "bro", "cafe", "choi", "cia", "comin", "connor", "cos", "couldn", "da", "dammit",
	"de", "didn", "dna", "doesn", "doin", "dong", "dont", "el", "elderman", "en", "erm", "et",
	"ew", "fbi", "fella", "fellas", "fu", "fuckin", "gettin", "goin", "hadn", "hasn", "hee", "heh",
	"herr", "hiya", "hm", "hmm", "iike", "iittle", "im", "isn", "ja", "jen", "ji", "jin",
	"kang", "kung", "lex", "lf", "liam", "ling", "ll", "lookin", "lsn", "manny", "mcgee", "mikey",
	"mmm", "mustn", "nah", "needn", "ng", "nicky", "nothin", "ofthe", "ohh", "oi", "ok", "ooh",
	"ou", "outta", "pos", "que", "raj", "sarge", "shh", "shouldn", "somethin", "tae", "talkin", "tryin",
	"tv", "uhh", "un", "unh", "ve", "von", "wasn", "weren", "wha", "whoo", "wouldn", "xena",
	"ya", "yay", "yi", "yu", "zach", "zack",
];

/** Proper nouns we keep anyway — the calendar, the alphabet of nationalities, the holidays. */
export const KEEP: readonly string[] = [
	"african", "africans", "american", "americans", "april", "august", "australian", "brazilian", "british", "canadian", "chinese", "christian",
	"christmas", "december", "dutch", "easter", "english", "european", "europeans", "february", "french", "friday", "german", "germans",
	"greek", "halloween", "indian", "indians", "irish", "italian", "italians", "january", "japanese", "jewish", "july", "june",
	"korean", "latin", "march", "may", "mexican", "monday", "muslim", "november", "october", "russian", "russians", "saturday",
	"september", "spanish", "sunday", "thursday", "tuesday", "valentine", "wednesday",
];
