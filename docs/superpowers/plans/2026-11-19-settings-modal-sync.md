# Plan: settings modal rework + goal-WPM sync fix

Spec: `docs/superpowers/specs/2026-11-19-settings-modal-and-goal-sync-design.md`
Branch: `settings-modal-sync`

- [x] 1. Write failing unit tests: `Sync.pull` returns `settingsAt` + stored `settingsLocalAt`; `pushSettings` stamps it.
- [x] 2. Implement the Sync changes (state field, stamp-before-put, pull surface).
- [x] 3. `Account.syncNow`: adopt only when remote newer, stamp on adopt, skip echo push; add `settingsChanged()`; host `writeGoal`/`writeCurriculum` persist.
- [x] 4. `app-main`: `#goal` and `#curriculum` call `settingsChanged()` after saving.
- [x] 5. Failing e2e: settings dialog fits a 720px-tall viewport (content scrollable, close reachable); then modal CSS (max-height, overflow, sticky head, 26rem).
- [x] 6. Modal markup: four group headings; account line wraps; keep every e2e-referenced selector.
- [x] 7. Run `npm test` and the touched e2e specs (`sync`, `layout`, `daily`, `practice`, `keeb`) green; typecheck.
- [ ] 8. Reviewer over the branch, push, open PR, report links (Michael merges).
