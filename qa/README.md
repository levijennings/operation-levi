# qa/ — the test suite for Levi's Projects

**Committed 2026-08-22, after the previous suite was lost.**

## Read this first

There was a suite before this one: 92 automated checks, a 37-step manual script,
and an audit log going back to 2026-08-19. It lived only in a session workspace
and was **never committed to this repository**. Committing it was raised three
times and did not happen. On 2026-08-22 the workspace was gone and so was the
suite.

What you are looking at is a re-authoring against build `109cfb5`, built from the
doctrine and the guard names that survived in the project knowledge base.
**Coverage is roughly a third of what was lost.** That is stated plainly here so
nobody reads `29/32 passing` as better news than `87/92 passing`.

The right way to get back to full coverage is the feature gate — every feature
adds a guard — not a reconstruction sprint. A check rebuilt from a category count
asserts something different from the one it replaces, and it will be green for the
wrong reason.

## Run it

```bash
npm install                      # playwright only; the browser is pre-installed
node qa/suite.mjs                # the automated checks
node qa/mutate.mjs               # prove the guards actually test something
```

Environment:

| Variable | Meaning |
|---|---|
| `QA_REPO` | repo root to test (default `/tmp/ol`; set it to this checkout) |
| `QA_ONLY` | comma-separated check ids or categories to run |
| `QA_CHROMIUM` | path to the chromium binary |

The harness serves the repo itself over loopback — no `python3 -m http.server`
step, no port collisions.

## Two suites, deliberately separate

|  | Automated (`suite.mjs`) | Manual (`manual.json`) |
|---|---|---|
| Runner | headless Chromium | a person clicking |
| Target | a local checkout | **production, real data** |
| Catches | regressions, structure, contracts | wrong numbers, bad judgment, visual defects, real-auth behaviour |
| Cadence | every change | before and after each release |

**The split is the whole point.** Every defect of consequence found so far was
invisible to the automated suite — pages rendered perfectly, zero page errors,
every structural assertion green. They were only found by cross-checking displayed
figures against the underlying records, by reading output as a person, or by Levi
noticing something felt wrong.

The clearest case: **email had never been delivered, ever.** The code is correct.
The API returns HTTP 200. Only the `ok:false` buried in the response body tells the
truth. No automated check could have caught it. The manual step that would have
was the one that sat unrun the longest.

## Design rules

1. **Every entry is executed.** Nothing is green because it was believed to work.
2. **Each check names what it proves**, in plain language. Levi's ask: *"seeing a
   list of features in a section and know they're working is good."*
3. **Guards are mutation-tested.** Break the subject, confirm the check fails,
   restore. `mutate.mjs` does this. A mutation that changes nothing proves nothing
   — check the target is load-bearing before trusting a kill.
4. **A failure and an error are different things.** A thrown `assert()` is a FAIL:
   the product disagreed with the check. Anything else is an ERROR: the check
   itself broke. Never conflate them — six of the original suite's first seven
   "failures" were bugs in its own assertions.
5. **Never mark a manual step verified without doing it.** Violated once. It is the
   single easiest way to make the whole register worthless.
6. **UX and mobile are first-class**, not an afterthought category.

## The trap that keeps recurring

Many app functions are **module-scoped** and unreachable from `page.evaluate()`:

```
lpToggleTop3 · top3Ids · showHome · showPlays · lpTravelEdit · persist
draftFor · lpNextStep · openReview · newItemBase · lpBackfillOrigins
```

A guard that calls one **silently no-ops and passes vacuously.** This has produced
at least four false greens. Drive the real control instead — click the ☆, click
the Plays tab, press the key — and assert the effect registered before asserting
anything else.

Selector notes learned the hard way on this build:

- The Today panel is `#ol2Home`, not `#ol2Today`.
- Board column headers are `.col > h3` with a `.cnt` span — there is no `.colh`.
- Card actions are `.tact` with `.tadone` / `.tadel` — there is no `[data-done]`.
- Column collapse is the `.colc` class, not an inferred width.
- Wingman hub tabs are `a` elements inside `.wtabs`.
- Review lane sub-controls (`#ol2LaneA` etc.) only mount when the lane is open.
- The modal keeps Save on screen with a bounded flex column, **not**
  `position:sticky` — assert the mechanism that ships, not the one you assumed.

## Current state — run R008, build `109cfb5`, 2026-08-22

**29 of 32 pass. 3 fail. 0 errors. 8 of 8 mutations killed.**

All three failures are real, known, open defects:

| Check | Defect | Owner |
|---|---|---|
| `X34A` | `docs.json` (dated 2026-08-17) never mentions **Today**, the app's main destination. Wingman answers app questions from these pages, so it confidently misdirects. | build |
| `X34B` | `docs.json` still describes **My Day**, **My Week** and **Libraries** — surfaces that no longer exist. | build |
| `S4` | `vercel.json` cron is `30 13 * * *`, a fixed UTC hour. The 6:30am brief becomes **5:30am** when Pacific leaves daylight time, while Settings still claims 6:30 year-round. | build |

Open and **not** covered by any automated check, because they structurally cannot
be: **X18** (email has never been delivered — needs `levisprojects.com` verified at
resend.com/domains and `RESEND_FROM` set in Vercel), **MF-6** (the brief cannot see
client-generated recurring occurrences), **MF-5** (Wingman badge flashes 0 on first
paint).

## Coverage gaps to close through the gate

- No drag-and-drop check between columns.
- No check that charts plot real numbers rather than empty axes.
- No check on goals, crew, travel or task-detail behaviour — whole categories from
  the original suite have no replacement yet.
- The production `/api/*` 401 smoke test is still manual and could be automated
  against the live domain.
- The review lane is proved to exist, not proved to work. That needs real data and
  stays manual step **X20**.

## Honesty corrections worth keeping

- The register once recorded email as "confirmed working" on the strength of a test
  that only checked the notify call *fired*. No inbox was ever opened. Corrected to
  X18 — and X18 turned out to be the biggest finding in the project.
- The first MF-1 fix was a well-built verification layer for model fabrication,
  aimed at the wrong cause: the API's own count was genuinely wrong. **Trace a
  symptom to the server's own numbers before assuming the model is at fault.**
- A routed task was described as passing through "In progress". It does not —
  `assignTri` sets `status:'thisweek'`, which the board groups under **Backlog**.
- `history.json` must not be hand-edited to add a run. The build script appends and
  dedupes on `ranAt`; a hand-written entry with an invented timestamp logs the same
  run twice. This happened on R006 and had to be unwound.
