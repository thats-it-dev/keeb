# Keeb

A touch-typing trainer for real keyboards, including splits. It times every key you press, works out
which keys are slowing you down, and generates lessons from the most frequent English words that use
those keys. Your layout and progress live in your own atproto repository, not on our server.

Live: <https://keeb.thatsit.app> · Repo: <https://github.com/thats-it-dev/touchtype> (the repo keeps the old name; the app does not)

## Run it

```sh
npm ci
npm run dev        # no sign-in here: the OAuth server only accepts https redirects
npm run typecheck && npm test && npm run e2e
```

`npm run e2e` builds and previews locally; `BASE_URL=https://… npm run e2e` tests a deployed site.

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
| M2 lesson engine, word generator, IndexedDB, practice pane | shipped on `main` |
| M3 layout import — a keyboard's `info.json` or a layout editor export | shipped on `main` |
| M4 atproto: OAuth sign-in, `settings`/`progress`/`session` records | in review |
| M5 publish the lexicons, DNS authority, stats screen | planned |

## Data model

Namespace `app.thatsit.typing.*`, authority a `_lexicon.thatsit.app` DNS TXT record pointing at the
publishing repository (that publication is M5). Records are written with `validate: false`, because a
PDS cannot fetch a lexicon that is not published yet — so the shapes are enforced by `test/lexicons.test.ts`
instead, which runs the real DRISL validator over the same objects in `src/atproto/lexicons.ts`.

| NSID | Key | Holds |
| --- | --- | --- |
| `app.thatsit.typing.defs` | — | shared objects: `#keyGeometry`, `#charMap`, `#keyStats` |
| `app.thatsit.typing.layout` | `tid` | a shareable layout: geometry + character map |
| `app.thatsit.typing.settings` | `literal:self` | active layout, target speed |
| `app.thatsit.typing.progress` | `tid` per layout | per-key samples; additive, so two devices merge by summing |
| `app.thatsit.typing.session` | `tid` | one practice session, oldest pruned past ~50 |

No keystroke ever becomes a record. Records are per-session aggregates.

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
