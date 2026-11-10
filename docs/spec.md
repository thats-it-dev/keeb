# Spec: how keybr's guided lesson teaches

Written before the keeb implementation, per `AGENTS.md` ("Clones and 'like X' apps: write
`docs/spec.md` with the original's actual algorithm"). This is a description of behaviour, read out of
[keybr.com](https://github.com/aradzie/keybr.com) at `master` on 2026-11-09. keybr is **AGPL-3.0**, so
nothing here is a copy of their code, data or wording: keeb reimplements the algorithm from this
document, and our corpus stays the MIT one described in `scripts/make-corpus.ts`.

Where I read it:

| File | What it decides |
| --- | --- |
| [keybr-lesson/lib/guided.ts](https://github.com/aradzie/keybr.com/blob/master/packages/keybr-lesson/lib/guided.ts) | which letters are in the lesson, which one is focused, which words get generated |
| [keybr-lesson/lib/key.ts](https://github.com/aradzie/keybr.com/blob/master/packages/keybr-lesson/lib/key.ts) | `LessonKey`: included / forced / focused, and the two confidences |
| [keybr-lesson/lib/target.ts](https://github.com/aradzie/keybr.com/blob/master/packages/keybr-lesson/lib/target.ts) | `confidence = goal time-per-key / measured time-per-key` |
| [keybr-lesson/lib/settings.ts](https://github.com/aradzie/keybr.com/blob/master/packages/keybr-lesson/lib/settings.ts) | the five guided knobs and their defaults |
| [keybr-result/lib/keystats.ts](https://github.com/aradzie/keybr.com/blob/master/packages/keybr-result/lib/keystats.ts) | how `bestTimeToType` is accumulated |
| [keybr-phonetic-model/lib/phoneticmodel.ts](https://github.com/aradzie/keybr.com/blob/master/packages/keybr-phonetic-model/lib/phoneticmodel.ts) | word generation from the n-gram table |
| [keybr-phonetic-model/lib/transitiontable.ts](https://github.com/aradzie/keybr.com/blob/master/packages/keybr-phonetic-model/lib/transitiontable.ts) | the table shape: context segment → next letter + frequency |
| [keybr-phonetic-model/lib/filter.ts](https://github.com/aradzie/keybr.com/blob/master/packages/keybr-phonetic-model/lib/filter.ts) | `codePoints` (allowed) + `focusedCodePoint` (mandatory) |
| [keybr-phonetic-model/lib/letter.ts](https://github.com/aradzie/keybr.com/blob/master/packages/keybr-phonetic-model/lib/letter.ts) | `frequencyOrder` / `weightedFrequencyOrder` |
| [keybr-phonetic-model/lib/censor.ts](https://github.com/aradzie/keybr.com/blob/master/packages/keybr-phonetic-model/lib/censor.ts) + [blacklist/](https://github.com/aradzie/keybr.com/tree/master/packages/keybr-phonetic-model/lib/blacklist) | runtime rejection of words the model invents |
| [keybr-generators/lib/generate-languages.ts](https://github.com/aradzie/keybr.com/blob/master/packages/keybr-generators/lib/generate-languages.ts) | how the model is trained off a frequency dictionary |
| [keybr-lesson/lib/dictionary.ts](https://github.com/aradzie/keybr.com/blob/master/packages/keybr-lesson/lib/dictionary.ts) | real-word lookup by allowed letters and by focused letter |
| [keybr-lesson/lib/text/words.ts](https://github.com/aradzie/keybr.com/blob/master/packages/keybr-lesson/lib/text/words.ts) · [text/fragment.ts](https://github.com/aradzie/keybr.com/blob/master/packages/keybr-lesson/lib/text/fragment.ts) | dedupe, capitals/punctuation, line length |

## 1. One lesson object, recomputed after every result

`update(keyStatsMap)` is a pure function of (settings, keyboard, stats). It returns a set of
`LessonKey`s, each flagged included / forced / focused. Nothing is remembered between calls: the whole
curriculum is re-derived from the history of results, so a lesson can never get stuck in a state the
numbers do not justify. `generate(lessonKeys, rng)` then turns that set into text.

keeb equivalent: `ladder(r, stats, targetCpm)` and `lesson(...)` are already pure and are recomputed at
every run boundary in `src/lesson/engine.ts`. That shape survives; only the rules inside change.

## 2. Letter order: frequency first, keyboard as a setting

`#getLetters()` sorts the model's letters into teaching order.

- default — `Letter.frequencyOrder`: by that letter's corpus frequency, descending; ties by code point.
  Frequencies come from the trained table, not from a hand-written list.
- `guided.keyboardOrder = true` — `Letter.weightedFrequencyOrder(letters, keyboard.weight)`, where
  `Keyboard.getCodePoints` gives weight **1 to home-row characters, 2 to top-row characters, 1000 to
  everything else**, and the sort keeps frequency as the tie-break. So keyboard order is not a fixed
  finger path: it is "the cheapest row first, most frequent letter within that row first".

There is no starting group of nine. The letters a learner begins with are simply the first six in that
order — in keeb's corpus that comes out as `e a s r t n` — enough letters to make words possible, which is
the actual reason a course needs a starting group. The six are a consequence of the data, not a constant:
`START_SIZE` says how many, and `frequencyOrder()` in `src/lesson/model.ts` says which.

## 3. Which letters are in the lesson

```text
minSize = 6
maxSize = minSize + round((letters.length - minSize) * guided.alphabetSize)   // alphabetSize ∈ [0,1], default 0
```

Then, walking the letters **in teaching order** and starting from an empty set:

| Condition, checked in this order                                | Action                                                                                             |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| fewer than `minSize` letters included                          | **include** — guarantee the alphabet floor                                                         |
| fewer than `maxSize` letters included                          | **force** — include, and mark it `isForced`                                                        |
| this letter's own `bestConfidence >= 1`                        | **include** — a letter you were once fast on is never taken away                                   |
| `recoverKeys` is **false** (default): every included letter's `bestConfidence >= 1` | **include** — the next letter arrives only when all the ones you already have have *each* been at goal at some point |
| `recoverKeys` is **true**: every included letter's *current* `confidence >= 1` | **include** — same gate, measured now instead of ever                                              |
| otherwise                                                      | leave it out; keep walking                                                                         |

Three properties worth naming, because they are the whole design:

1. **One at a time.** After the floor of six, the gate is checked against the included set *as it grows*,
   so a letter admitted by row 4 of the table immediately fails row 4's condition for the next letter —
   until that letter itself has been at goal. Letters arrive singly, in order.
2. **Unlock on best, not on now.** With the default, a letter that once hit goal confidence stops
   blocking, even if today's average has slipped. `recoverKeys` is the switch to the pessimistic version.
3. **No deadlocks.** The rule has nothing to do with rows, columns or fingers, so a letter that no word
   can be built from cannot stall the ladder: it is simply the weakest letter below target, which is
   exactly the letter the next section makes the learner practise.

`alphabetSize` is a "how much of the board do you want to be given at once" knob for people who want
letters forced in ahead of mastery. With the default 0, `maxSize == minSize` and the force branch is
unreachable.

## 4. Confidence, and "best" confidence

- `timeToType` — the key's smoothed time per stroke, in ms. It is an EMA with α = 0.1 (`makeFilter(0.1)`)
  over per-session aggregates, so one session moves it a tenth of the way.
- `bestTimeToType` — `min` of every `timeToType` that key has ever had, updated whenever a session record
  arrives with a positive time. It is monotone non-increasing: a key never loses its best.
- `confidence = speedToTime(targetSpeed) / timeToType = (60000 / targetCpm) / timeToType`, and
  `bestConfidence` is the same formula on `bestTimeToType`. `null` when there is no measurement, and
  `null` compares as 0 — an untouched key is never confident.

Note the unit: keybr's `targetSpeed` is **characters** per minute (default 175), and its own docs convert
to words by dividing by 5. This is already keeb's convention (`targetCpm`, `CHARS_PER_WORD`), so no
translation is needed.

Only "the key was measured this session" feeds `best`: an unmeasurable interval is skipped, not stored as
0. keeb has the same trap already documented in `src/stats/stats.ts` (`hasTiming`), so `bestMs16` must be
carried forward untouched by a stroke that produced no observation.

## 5. The focused key

```text
weakest = included letters with confidenceOf(key) < 1, sorted ascending by confidenceOf
if (weakest.length) focus(weakest[0])
```

where `confidenceOf` is `bestConfidence` by default and `confidence` under `recoverKeys`. Exactly one
letter is focused, it is always a letter the learner already has, and it is the one that has never been
good enough. Focus is cleared if that letter gets excluded again.

The focused letter is not just a label. It is passed to the word generator as a **hard constraint**:
`new Filter(includedLetters, focusedLetter)` means every generated word, and every real word chosen from
the dictionary, contains it. The keyboard highlights it, and the lesson UI names it. So "practise the
weakest key" is not advice inside the lesson; it _is_ the lesson.

## 6. Word generation: the phonetic model

The model is a letter n-gram table trained on a word-frequency dictionary
(`generate-languages.ts`):

- `new TransitionTableBuilder(4, [space, ...alphabet])` — order 4, i.e. the last **3** symbols predict the
  next. Space is a symbol in the alphabet and stands for both word-start and word-end; two spaces in a row
  collapse to one.
- Each word contributes `count` passes over the chain (`normalizeCounts` first rescales counts so the
  rarest kept word is 1). Words shorter than 3 characters are not trained on at all.
- The dictionary is the top 10 000 words by count.
- Frequencies are then scaled per segment to sum to 255 and stored in bytes; a segment with no data is
  empty, which the generator treats as a dead end.

`nextWord(filter)` at runtime
([phoneticmodel.ts](https://github.com/aradzie/keybr.com/blob/master/packages/keybr-phonetic-model/lib/phoneticmodel.ts)):

1. Seed the word from `PrefixList`. If a letter is focused, walk the table to collect every prefix of
   length 1..3 that **contains** the focused letter and only allowed letters, and start from one of those
   at random; if none exist, start from the focused letter alone. With no focus, start from nothing.
2. Ask the table for the continuation of the last 3 symbols. Drop any candidate that is not an allowed
   letter (space is exempt from the filter — it is how a word ends).
3. Boost space by `1.3 ^ word.length` so longer words are progressively more likely to stop.
4. Sample a weighted next symbol. Space ⇒ the word is finished.
5. Dead end, or longer than 10 characters ⇒ restart from a new prefix, up to 5 attempts; after that the
   partial word is returned as-is.
6. A word shorter than 3 is not allowed to end: the space candidate is dropped until `minLength`.

The result is pronounceable gibberish — `rasen`, `tesha`, `nidar` — which is the point: the shape of
English keeps the lesson readable while the letter set stays exactly the unlocked one. Real English words
cannot be offered at 6 letters in any quantity (`rain`, `near`, `nears`, `saner` is about the whole list),
which is why keybr's default text is generated rather than selected.

keeb adaptation: our table is trained at **order 3** (last 2 symbols predict next) because our corpus is
4 000 words, not 10 000 with counts, and at order 4 most contexts would be empty. Missing contexts back
off to the 1-symbol context, then to the letter frequencies — and so does a context that offers nothing but
locked letters, which is the same dead end from the learner's side. Same generator loop.

Two things keybr gets from a 10 000-word dictionary with counts, we add explicitly (`phonotactics.ts`):

- **A prefix list, weighted by rank.** A generated word starts from the opening of a real corpus word
  (length 1..3, every letter unlocked, the focused letter inside it), so its first two or three letters are
  ones English actually opens a word with. Where a required letter lands inside the word is the model's
  business: dropping it into a slot picked at random is what produced `zdial` and `hcone`.
- **A phonotactic gate.** The corpus's own consonant runs — onsets, codas, and the prefixes of onsets, so a
  half-built cluster is not cut off — decide what the chain may add next and what it may stop at. A medial
  run may split into one syllable closing and the next opening (`-mp` + `-pr-`, as in `impress`). A doubled
  letter is legal exactly when the corpus doubles it: `ll`, `ee`, `tt` yes, `ii`, `uu`, `ww` no. Refusing
  every double was a rule the language does not have, and it pushed the model towards shapes nobody can
  read out loud.

## 7. Real words as a setting

`guided.naturalWords` (default **true** in keybr) selects the source of words:

- **off** → the phonetic model, above.
- **on** → `dictionary.find(filter)`, which is: every word in the index that (a) is built only from
  allowed letters and (b) — when a letter is focused — contains it, taken through a per-letter inverted
  index so the focused-letter list is found directly. Cut to 1 000 candidates.
- If that yields fewer than 15 words, top the list up with generated pseudo-words. If it yields none, use
  the literal `"?"` as a word rather than emitting an empty line.

That fallback is the answer to "the learner has 6 keys and wants real words": they get the handful of real
ones plus model words of the same letter set, instead of a blank screen.

keeb deviation: our default is **off** (generated). Michael's brief is generated words first, real words as
the opt-in, and it keeps the first screen honest about which keys are in play.

## 8. From a word stream to a line of text

- `uniqueWords` — if the generator repeats the previous word, try again, up to 3 attempts, then accept it.
  Repetition is the thing that makes a generated lesson feel broken.
- `mangledWords` — with probability `capitals` capitalise the word; with probability `punctuators` attach
  a weighted-random punctuation mark (`,` `.`, `!`, `?`, `;`, `:`, `'`, `"`, `-`); a hyphen joins two
  generated words. Defaults are 0 and 0, so the plain lesson is lowercase letters and spaces.
- `generateFragment` — keep appending words (each repeated `repeatWords` times, default 1) until the line
  reaches `100 + 100 * lesson.length` characters. Default line: about 100 characters, i.e. ~15 words.
- Space is always the separator, so the space bar is in every lesson from the first key.

## 9. Keeping the words clean

Two layers, because a probabilistic model can produce a word nobody trained it to intend.

1. **The dictionary**
   ([generate-languages.ts](https://github.com/aradzie/keybr.com/blob/master/packages/keybr-generators/lib/generate-languages.ts)):
   lowercase everything, keep only words the language's own character test accepts, drop duplicates, keep
   the top 10 000 by count, and require length ≥ 3 for the model (`> 2` for the word list). That single
   length rule is what removes the `don`, `isn`, `oh`, `ok`, `id`, `ha` fragments a raw subtitle dump is
   full of.
2. **The censor**
   ([blacklist/blacklist.ts](https://github.com/aradzie/keybr.com/blob/master/packages/keybr-phonetic-model/lib/blacklist/blacklist.ts)):
   at generation time, `nextWord` loops until the word is not in a per-language blacklist — ~525 English
   entries, stored character-scrambled (`scramble.ts`, an affine permutation) so the list does not read as
   a block of profanity in the repository. Model _training_ is not filtered; only output is.

keeb does the same two layers, with the plaintext list in `scripts/make-corpus.ts` (our repo has no
scanning problem to solve) plus a runtime rejector over the same roots for generated words. Our corpus
needs rules keybr does not: the source dump is TV subtitles, so contraction fragments (`don`, `didn`,
`gonna`, `outta`), interjections (`oh`, `uh`, `yeah`, `dude`) and lowercased names (`god`, `john`,
`mike`) all appear as "words".

## 10. Settings, side by side

| keybr (`guided.*`)                     | default         | keeb equivalent                                          |
| -------------------------------------- | --------------- | ---------------------------------------------------------- |
| — (hard-coded `minSize = 6`)           | 6               | `START_SIZE` in `src/lesson/ladder.ts`                   |
| `keyboardOrder`                        | false           | `keyboardOrder` — teach by row cost, then frequency      |
| `alphabetSize`                         | 0               | not implemented; no letters are forced in ahead of mastery |
| `recoverKeys`                          | false           | not implemented; keeb unlocks on best confidence, always   |
| `naturalWords`                         | true            | `realWords`, default **false**                           |
| `targetSpeed`                          | 175 cpm         | `targetCpm` (Settings → goal wpm × 5)                  |
| `length`                               | 0 (≈100 chars) | `WORDS_PER_LINE`                                         |
| `capitals` / `punctuators` / `repeatWords` | 0 / 0 / 1     | not implemented                                          |

The two switches keeb adds live in the per-layout `Settings` (`src/data/store.ts`) and in the
`app.thatsit.typing.settings` record, so they follow the learner between devices. What is deliberately not
there is the set of unlocked letters: that is a verdict about this learner's numbers, and storing it would
put a second, storable answer next to the one `ladder()` derives from stats that also sync.

## 11. What keeb changes, and why

| keybr                                                  | keeb                                       | reason                                                                                                                     |
| ------------------------------------------------------ | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| per-session sample list, EMA recomputed client-side  | `bestMs16` stored in the key stat          | we store one aggregate per key, not a sample list; a `min` still merges across devices without double-counting anything |
| letters keyed by code point                            | letters keyed by **key id**, resolved through `Resolved.byChar` | geometry × keymap are separate: on a Colemak-DH board the lesson must teach positions, and `q` means a different finger depending on the keymap |
| full 104-key keyboard                                  | the keys this layout teaches (`key.taught`) | a Corne has no number row to order                                         |
| space is a symbol in the n-gram alphabet               | space is a separator, always allowed        | our keystrokes are attributed to a key id; the space bar appears in every line and proves nothing about the rest of the board (same reason `ladder.ts` already refuses to let it gate an unlock) |
| `Lesson` object held across a session, `update()` on each result | `ladder()` recomputed at each run boundary | unchanged in spirit; a line is the unit that exists in keeb                                  |
| focused letter drawn in the lesson header              | focus shown on the line, the keyboard and the progress list | one of our rules is "never convey state by colour alone", so focus needs a shape as well                     |

## 12. Behaviour this spec must be testable against

1. A learner with no practice at all gets exactly the 6 most frequent letters of the corpus, and the same
   6 again after a reload.
2. With `keyboardOrder` on, the first letters are the home row in frequency order, and no lower-row
   letter precedes an upper-row one.
3. The 7th letter arrives only when each of the letters already in the lesson has been at goal at some
   point; two letters never arrive in one run.
4. A letter whose current speed has dropped below goal but whose best was above it does **not** block the
   next letter, and is not the focus.
5. `focus` is the included letter with the lowest best confidence; with no data it is the first letter of
   the order; it is `undefined` only when every included letter has been at goal.
6. Every word in a generated line contains the focused letter and uses only unlocked letters.
7. Every unlocked letter appears in the line within a bounded number of runs, so no unlocked letter can
   sit unfocused and unpractised forever. A line forces at most three of them, and it forces the focused
   letter into each of those words too.
8. Generated words are pronounceable: every one contains a vowel, opens and closes its syllables with
   clusters the corpus itself uses, doubles a letter only where the corpus doubles it, and is not in the
   blocked list.
9. With `realWords` on, words come from the corpus; when fewer than 15 fit the unlocked letters, generated
   words top the list up instead of the screen going blank.
10. The corpus contains no profanity, no contraction fragment, no interjection and no proper name, and the
    same check runs over generated output.
11. A stroke with no measurable interval changes `samples` but never `bestMs16`.
12. Merging a progress record with itself does not change `bestMs16` (min is idempotent) and does not
    double `samples`.

## 13. Daily time goal (not from keybr)

The day belongs to keeb, not to the clone, so it is specified here rather than against keybr's code:

1. Today's minutes are keystroke time: each gap between consecutive keystrokes counts, capped at 10
   seconds, and so does at most a cap's worth of the silence after the last one. Idle with the tab open
   is never practice, and the bar stalls within ten seconds of the fingers leaving the keyboard.
2. The minutes come from a local daily tally (`daily` store), never from the synced session rows: a
   signed-out device has no session rows, and the bar must read correctly before any sync has run.
   The two sources are deliberately not merged, so a session charged to the tally is not also counted
   from the repo.
3. The bar shows the open session's keystroke time immediately, so it moves while typing and freezes
   at the cap when typing stops; the closed part is charged once, at `SessionRecorder.end()`, whether or
   not it reaches a repo. The fold lands in memory before the write is attempted, so a tab torn down
   mid-write still shows the minutes. The synced session record still carries the full span — the
   history chart's speed maths needs the wall clock, and only the day tally uses the capped sum.
4. The goal in minutes lives in a browser-wide localStorage slot, not in the per-layout settings —
   the tally it measures is device-wide — and never on the wire: `settingsRecord` keeps carrying
   exactly the fields it carried before. 0 hides the bar.
5. The tally keeps 7 local calendar days and the bar reads only today, so a stale row cannot stack a
   second charge onto a session already counted. `chargeDaily` reads, folds and writes in one IndexedDB
   transaction, so a second tab's charge is added to, never overwritten by, this one's wholesale write.
