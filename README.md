# keeb, that's it.

A touch-typing trainer for real keyboards, including splits. It times every key you press, works out
which keys are slowing you down, and generates lessons from the most frequent English words that use
those keys. Your layout and progress live in your own atproto repository, not on our server.

The name lives in `app.config.json`: `title` ("keeb, that's it.") is the app's name — the browser tab, the
manifest install label, and the name on the atproto consent screen; `heading` ("keeb") is the wordmark —
the `<h1>` on the page and the short label a launcher puts under the icon; `name` ("keeb") is the
identifier — the repo, the Pages project, the storage prefix and the client id's hostname. `heading` is
optional because most apps want one string everywhere.

Live: <https://keeb.thatsit.app> · Repo: <https://github.com/thats-it-dev/keeb>

## Run it

```sh
npm ci
npm run dev        # no sign-in here: the OAuth server only accepts https redirects
npm run verify
```

Agents: read `AGENTS.md`.

Scripts: `dev`, `build`, `preview`, `typecheck` (tsc), `test` (vitest, including the repo guardrails in
`test/guardrails.test.ts`), `lint` (knip: unused files, exports and dependencies), `e2e` (Playwright on
desktop and phone; builds and previews locally, or `BASE_URL=https://… npm run e2e` tests a deployed site),
`e2e:one` (one spec, desktop only: `npm run e2e:one -- e2e/x.spec.ts`), `verify` (all of the above, before
a commit), `icons`, `lexicons` and `lexicons:publish`, `kit-types` (fetches the kit's `.d.ts` into `.kit/`;
runs automatically before dev, build and typecheck).

Sign-in can only be exercised on a deploy whose origin is listed in `REDIRECT_URIS`
(`src/atproto/auth.ts`) and in the hosted `public/.well-known/oauth-client/client-metadata.json`. Two
rules the authorization server, not this repo, enforces: the client is `application_type: "web"`, so a
loopback (`http://127.0.0.1:…`) redirect is refused — it is allowed only for native apps; and a
loopback-shaped redirect must never use the `localhost` hostname (RFC 8252). Both are checked by
`test/oauth-client.test.ts`, because the library's own schema is more permissive than the server.

The server also fetches `client_id` — a URL on the production origin — so a branch preview cannot
complete a login until the build that ships `/.well-known/oauth-client/` has landed on `main`.

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

1. Each keystroke records one sample per key: time since the previous key, and whether it was right. The
   mean moves 1/16 of the way toward each timed stroke, and a stroke more than four times the current mean
   counts as that multiple — a keystroke interval is evidence about typing, the gap after you went to make
   tea is evidence about the kettle.
2. `confidence = goal time-per-key / your time-per-key`. 1.0 means you hit the goal on that key. Each key
   also keeps `bestMs16`, the fastest that mean has ever run. The curriculum reads the best; every screen
   reads the current one.
3. A new learner starts on the six letters the corpus uses most (`e a s r t n`), not on a home row. Six
   letters are the fewest that can spell something; the row they live on is the keymap's business, not the
   lesson's. `keyboardOrder` in Settings ranks by row cost instead — home row, then upper, then the rest,
   most frequent letter first inside a row.
4. The next letter arrives when every letter already in play has been at goal speed **at some point** —
   best confidence, not this week's. A letter that has just been handed out has never been good enough, so
   exactly one letter joins per round. See `src/lesson/ladder.ts`.
5. The lesson is built around `focus`: the included letter with the lowest best confidence. It is ringed on
   the board, named in the readout, marked in the progress list, and present in every word of the line.
6. Words come from a letter n-gram model trained on the corpus, because six letters of real English is a
   shelf of about four words and repeating them is not practice. `realWords` in Settings switches the source
   to the corpus and lets the model top up a thin pool. Both sources run the same rejection list.
7. Word weight is `frequency × (1 + weakness)`, so weak keys come back without an obvious loop.
8. Progress is written to IndexedDB on every keystroke, keyed `geometry+keymap`. Offline is the
   default; sync is an add-on.

## Progress

| Milestone | State |
| --- | --- |
| M0 repo, CSP, PWA shell | shipped on `main` |
| M1 geometry × keymap model, SVG keyboard view | shipped on `main` |
| M2 lesson engine, word generator, IndexedDB, practice pane | shipped on `main` |
| M3 layout import — a keyboard's `info.json` or a layout editor export | shipped on `main` |
| M4 atproto: OAuth sign-in, `settings`/`progress`/`session` records | shipped on `main` |
| M5 publish the lexicons, DNS authority, stats screen | shipped on `main` |
| M5.1 practice history — read the session records back and chart them | in review |
| M6 shareable layouts — publish a `layout` record, browse and load one | in review |
| keybr-style guided lesson — six letters, one focus, generated words, unlock on best | in review (see `docs/spec.md`) |

## Data model

Namespace `app.thatsit.typing.*`. Its authority is a DNS TXT record at `_lexicon.typing.thatsit.app`
carrying `did=did:plc:tr7zlhacx3fete5s7cx5tyjd` — the NSID minus its last segment, reversed, which is why
the record is not at the apex: resolvers look at exactly one name and do not walk up or down the tree, so a
record placed at `_lexicon.thatsit.app` would simply never be found.

The schemas themselves are published from `lexicons/`, generated by `npm run lexicons` out of
`src/atproto/lexicons.ts` (the one source; `test/lexicon-files.test.ts` fails if the directory drifts from
it).

**Records are still written with `validate: false`, and publishing did not change that.** I expected the
flag to become unnecessary once the schemas were on the network; it does not. A Bluesky-hosted PDS only
validates against lexicons it holds locally and will not fetch a third-party one on demand, so omitting the
flag fails every write with `Unknown lexicon type: app.thatsit.typing.settings` — verified against this
account, not theorised. With the flag the record stores fine and reports `validationStatus: "unknown"`,
which is the accepted route for a custom namespace.

So the shapes are enforced here instead, in two passes: `test/lexicons.test.ts` runs `@atproto/lexicon`
over the records this code writes, and `goat lex validate` runs the published schemas over the same files.
Running your own PDS and importing the lexicons into it (`com.atproto.admin.importLexicons`) is the only
thing that moves validation to the server.

Publishing is deliberate, because a published field name can never be changed:

```sh
npm run lexicons:publish   # regenerates, then `goat lex publish` (needs `goat account login`)
goat lex status             # local == network
goat lex check-dns          # the TXT authority resolves back to this account
```

Changing an already-published schema needs `goat lex publish --update`; plain publish refuses to overwrite.
That is also why the per-key identifier is `keyId` and not `id`: goat flags `id` as a reserved word across
language code generators, and records written under the old name are still read (see `wireKeyId`).

Publishing is worth doing for the record, but it does not move validation to the server — see above.

| NSID | Key | Holds |
| --- | --- | --- |
| `app.thatsit.typing.defs` | — | shared objects: `#keyGeometry`, `#charMap`, `#keyStats` |
| `app.thatsit.typing.layout` | `tid` | a shareable layout: geometry + character map |
| `app.thatsit.typing.settings` | `literal:self` | active layout, target speed, and the two curriculum switches |
| `app.thatsit.typing.progress` | `tid` per layout | per-key samples and each key's fastest mean; additive, so two devices merge by summing |
| `app.thatsit.typing.session` | `tid` | one practice session, oldest pruned past ~50 |

No keystroke ever becomes a record. Records are per-session aggregates.

Three fields are new in this round and all three are **optional**, which is what lets an old device keep
writing while a new one reads: `#keyStats.#row.bestMs16`, and `keyboardOrder` / `realWords` on `settings`.
A record that predates them is not migrated — `bestMs` falls back to the key's current mean, the honest
claim a record with no memory of its own past can make. Adding the fields to the published schemas needs
`npm run lexicons:publish` with `--update`; until that is done, nothing breaks, because the PDS is not the
thing validating these writes.

## Signing in and sync (M4)

Offline is still the default: signing in is one optional row in Settings, and nothing in the practice
loop waits for a network. What sync does, and why:

- **A session is the span between two silences.** It ends after two minutes without a keystroke, or when
  the tab closes. One record per session, keyed by its own tid.
- **Progress merges, it does not conflict.** `merge` adds the sample counts and weights each mean by its
  own count, so two devices can drift apart for a week and still combine without a coordinator. Two
  progress records for one layout is a normal accident (two browsers, both first runs): the newest wins
  outright rather than being averaged with a stale one.
- **Settings are adopted only on a quiet page.** Pulling a remote board in mid-lesson would yank the
  keyboard out from under the learner, so that merge happens at boot or when you press Sync.
- **Failures queue.** An unreachable PDS leaves the session in an IndexedDB outbox; the next session, or
  the next Sync, tries again. Nothing is ever dropped because a server was having a moment.

## Sharing a layout (M6)

A board you imported is one `app.thatsit.typing.layout` record: where the keys are, what each physical row
is for, and what each key produces. Settings, progress and sessions all name a layout by its ids, so a
second device that has never seen your file can still be told which board to draw.

- **The record's tid is the board's id.** Both devices derive `shared:<rkey>` from the same record, so a
  settings record that says `shared:2222abc` means the same keyboard everywhere. An id made from a filename
  would not survive the second browser, which is where `import:<name>` ids stop being useful.
- **Row roles travel with the positions.** Without them a receiving device cannot tell the home row from
  the number row on a board it has never seen, and the lesson engine, the fingering and the unlock ladder
  all key off that.
- **Characters are per key, not per row position.** A shared record fills `Keymap.byKey`, because a board
  that came out of someone's own file has letters on keys the classic 3x6 grid has no slot for. The row
  grid still decides for the shipped boards, and a `byKey` entry wins wherever both exist.
- **Publishing re-uses one record.** The rkey is remembered in the sync state, so pressing Publish twice
  updates a layout instead of growing a second near-duplicate that the other device would also adopt.
- **Boards are adopted before settings.** Shared layouts land first, because the check that adopts a remote
  board only accepts an id it can resolve — and this browser may have got that id from the record it
  downloaded two lines earlier.

The OAuth client is a first-party web app: `client_metadata.json` is served from
`/.well-known/oauth-client/`, the token flow is PKCE with DPoP and no client secret, and the library
keeps its keys and tokens in IndexedDB. The redirect URIs in that file have to match
`REDIRECT_URIS` in `src/atproto/auth.ts` — including any branch preview that wants to test a real login.

One consequence of `client_id` being a URL: the authorization server fetches it from **production**, so a
preview deploy cannot complete a login until the build that adds `/.well-known/oauth-client/` has landed
on `main`. Test sign-in after merging, not before — a preview's own copy of the document is never read.

`connect-src` in `public/_headers` admits `https:` for this one feature: a learner's PDS is whatever host
they chose, so it cannot be named in advance. `script-src`, `form-action` and `base-uri` stay shut. The
alternative — running the OAuth client inside the service worker, where page CSP does not reach — is
still open.

## Importing your own board

Settings → *layout file* takes either kind of JSON a board's config produces, and says what it could
not read rather than guessing:

- **keyboard-layout-editor `info.json`** (inside a ZMK or QMK config) describes *positions*: x, y, size,
  rotation, which half. It carries no characters, so the keymap stays a separate choice and an imported
  board pairs with all five layouts. Moergo labels (`L_C4R2`) give the hand and column; a file without
  them falls back to the widest gap in the middle.
- **A MoErgo Layout Editor / keycap export** describes *characters*: a `keyboard` field names the board
  and `layers[0]` lists bindings in that board's matrix order. It needs no positions, but it does need
  to know the board, so the keyboard named has to be one we ship. `&kp LS(MINUS)` and `&mt ESC GRAVE`
  resolve to the key underneath; macros, layer keys and mouse clicks type nothing.

Because the second format's ordering is inferred, it is checked: the keys outside the typing rows (the
number row and the outer column) are compared with what the board says they are, and an import where
they disagree is refused rather than drawing a board that lies about your fingers.

Boards and keymaps you import are saved in IndexedDB and appear in the pickers; importing the same
filename again replaces that entry rather than adding a twin.

This replaced an earlier plan to parse `.keymap` text. That was dropped on purpose: a `.keymap`
makes position *implicit* in the whitespace alignment of each line, so importing one means guessing
which board it belongs to — and the files above already describe the board.

## Notes for whoever picks this up

- **Do not store which letters are unlocked.** It is a verdict, and `ladder()` recomputes it from the stats
   on every line. A stored copy is a second answer to the same question, and the two disagree the first time
   a device syncs numbers the other has not seen. That field used to exist on `settings`; it is gone.
- `bestMs16` merges with `min`, never `max` and never a difference. `min` is the one combine that is
   idempotent, commutative and associative, so folding your own progress record back in cannot invent a
   faster key — and it means a key you once typed at goal speed stays taught through the week you did not.
- The n-gram model needs the rejection list *at generation time*, not only in the training data. A model
   trained on clean words will still produce `fuck`-shaped strings, because it stores letter patterns and
   not intentions. `isCleanWord` is called by both `scripts/make-corpus.ts` and `src/lesson/model.ts`.
- A `progress` record is a **shared accumulator**, not a device's own diary: `flush()` writes this
  browser's whole merged map into it, so the next pull hands our own numbers back. Folding that in as if it
  were somebody else's evidence added our strokes to our strokes, and every sync doubled the sample and
  error counts. The rule is `mergeAll(local, progressGrowth(seen, remote))`, where `seen` — the content of
  that record last accounted for — lives in the sync row and is written in the *same* IndexedDB
  transaction as the stats (`applyRemoteProgress`). Seeded on both sides: `flush()` on the way out (from the
  record it wrote, not a live reference to the caller's map), and the fold on the way in.
- **Never difference `mean × samples`.** It looks like a total you can subtract to get "the strokes that
  arrived in between", but the mean is exponentially weighted: the old observations have already decayed out
  of it, so the product is not the time they took. Doing it anyway reported a device that got *faster* as a
  key with no timing in it (0 ms) and a device that got *slower* as 1875 ms of a 400 ms stroke. The honest
  form is in `keyGrowth`: the new **count** is arithmetic, the new **mean** is not recoverable, so the fold
  takes the record's current mean and lets `merge` weight it by the strokes that are actually new. The bias
  is the record's own memory — about sixteen strokes — and it shrinks precisely when it would matter most.
- Counts already doubled by older builds stay doubled; the mean recovers on its own because it is
  sample-weighted, and the sample count only decides how stiff it is.

- The icon is generated, not stored art: `npm run icons` draws the Lucide `keyboard` glyph analytically
  (capsules and a rounded-rect ring, one pixel of antialiasing) into the same five PNG sizes plus
  `icon.svg`, on the pi-web approach — a small PNG encoder in the script, no canvas, sharp or rasterizer
  dependency. The Lucide package is a build-time read of `dist/esm/icons/keyboard.mjs` and is *not* a
  dependency; the path data in the script came from it and `icon.svg` mirrors the same shapes. The old
  dot artefacts were committed and the regenerated ones are staged — check the image before shipping.
- It was called TouchType until M4. The name lives in `app.config.json` (which also picks the Cloudflare
  Pages project, so the preview subdomain) and in the OAuth client id, which is a URL on the deployed
  origin. Progress is stored per *origin*, so the rename to `keeb.thatsit.app` started a fresh device
  record: anything practised on the old subdomain stays there until sync brings it across.
- Lit nested templates need lit's `svg` tag or SVG children land in the HTML namespace and paint
  nothing, silently. See `src/keyboard/view.ts` and `src/ui/icons.ts`.
- Anything imported must be registered *before* the saved selection is resolved: `saved()` runs in the
  field initializers against an empty registry, so an imported id falls back to the shipped default
  unless it is re-read after the IndexedDB load. Both halves of that are tested in `e2e/layout.spec.ts`.
- Compute derived render values inside `render()`, not in `updated()` writing to a private field —
  the latter never repaints on its own.
- Playwright's `hasTouch` projects swallow synthetic keystrokes; the phone project runs without it.
- The corpus is MIT-licensed third-party data (`scripts/make-corpus.ts` says where it came from). It
  is deliberately **not** the keybr corpus: keybr.com is AGPL-3.0 and this project only reimplements
  its published behaviour.
- Layout positions for `lily58` are our reconstruction, not a vendor file; the UI says so. Fix it from
  a real `info.json` when someone has one.
