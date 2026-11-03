# TouchType

A touch-typing trainer for real keyboards, including splits. It times every key you press, works out
which keys are slowing you down, and generates lessons from the most frequent English words that use
those keys. Your layout and progress live in your own atproto repository, not on our server.

Live: <https://touchtype.thatsit.app> · Repo: <https://github.com/thats-it-dev/touchtype>

## Run it

```sh
npm ci
npm run dev        # http://localhost:5173
npm run typecheck && npm test && npm run e2e
```

`npm run e2e` builds and previews locally; `BASE_URL=https://… npm run e2e` tests a deployed site.

## How it fits together

Two ideas carry the whole design.

**Geometry and keymap are separate.** A *geometry* is where the physical keys sit; a *keymap* is which
character each position produces. Any geometry pairs with any keymap, so a Go60 running Colemak-DH is
one selection, not a new layout file. Keystrokes are attributed by *character*, because on a board with
remapped firmware `KeyboardEvent.code` says nothing useful about where your finger was.

- geometries: `go60` (Moergo), `ansi60`, `corne`, `lily58` — in `src/data/`
- keymaps: QWERTY, Colemak-DH, Workman, Dvorak, Norman — in `src/data/keymaps.ts`

**Everything is an integer.** Key positions are 1/100 of a key unit, rotations are 1/10 of a degree,
and a key's mean time-to-type is milliseconds × 16 fixed point (`ttMs16`). atproto's data model has no
floating point type, so the numbers that work in the browser are already the numbers that get stored.

| Path | What lives there |
| --- | --- |
| `src/keyboard/` | geometry model, char resolution, SVG view |
| `src/stats/` | per-key samples, EWMA, confidence, the unlock ladder |
| `src/lesson/` | word corpus, lesson generator, engine, practice pane |
| `src/data/` | shipped layouts, keymaps, IndexedDB store |
| `scripts/make-corpus.ts` | regenerates `src/lesson/corpus.ts` from a frequency dump |

## The teaching model

1. Each keystroke records one sample per key: time since the previous key, and whether it was right.
2. `confidence = goal time-per-key / your time-per-key`. 1.0 means you hit the goal on that key.
3. The starting group is the whole home row, which is where real English words become possible.
4. The next key unlocks when every key that has actually been practised is at the goal speed. Keys
   never practised (the `j` and `k` that no home-row word contains) do not block, or the ladder
   deadlocks.
5. Word weight is `frequency × (1 + weakness)`, so weak keys come back without an obvious loop.
6. Progress is written to IndexedDB on every keystroke, keyed `geometry+keymap`. Offline is the
   default; sync is an add-on.

## Progress

| Milestone | State |
| --- | --- |
| M0 repo, CSP, PWA shell | shipped on `main` |
| M1 geometry × keymap model, SVG keyboard view | shipped on `main` |
| M2 lesson engine, word generator, IndexedDB, practice pane | in review, PR #2 |
| M3 ZMK keymap importer — paste a `go60.keymap` and get a keymap | planned |
| M4 atproto: OAuth sign-in, `settings`/`progress`/`session` records | planned |
| M5 publish the lexicons, DNS authority, stats screen | planned |

## Data model (M4+)

Namespace `app.thatsit.typing.*`, authority a `_lexicon.thatsit.app` DNS TXT record pointing at the
publishing repository. Custom lexicons are written with `validate: false`; PDSes fail open on them.

| NSID | Key | Holds |
| --- | --- | --- |
| `app.thatsit.typing.defs` | — | shared objects: `#keyGeometry`, `#charMap`, `#keyStats` |
| `app.thatsit.typing.layout` | `tid` | a shareable layout: geometry + character map |
| `app.thatsit.typing.settings` | `literal:self` | active layout, target speed |
| `app.thatsit.typing.progress` | `tid` per layout | per-key samples; additive, so two devices merge by summing |
| `app.thatsit.typing.session` | `tid` | one practice session, oldest pruned past ~50 |

No keystroke ever becomes a record. Records are per-session aggregates.

## Notes for whoever picks this up

- Lit nested templates need lit's `svg` tag or SVG children land in the HTML namespace and paint
  nothing, silently. See `src/keyboard/view.ts`.
- Compute derived render values inside `render()`, not in `updated()` writing to a private field —
  the latter never repaints on its own.
- Playwright's `hasTouch` projects swallow synthetic keystrokes; the phone project runs without it.
- The corpus is MIT-licensed third-party data (`scripts/make-corpus.ts` says where it came from). It
  is deliberately **not** the keybr corpus: keybr.com is AGPL-3.0 and this project only reimplements
  its published behaviour.
- Layout positions for `lily58` are our reconstruction, not a vendor file; the UI says so. Fix it from
  a real `info.json` when someone has one.
