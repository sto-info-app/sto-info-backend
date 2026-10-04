# FC-044 acceptance evidence

Full LCARS user journeys and capacity validation for Fleet Community v1
([FC-044 / #1154](https://app.shortcut.com/startrekonlineinfo/story/1154)): plan section 5's Help and
navigation journeys, the signed-in checks earlier stories left owed, the LCARS visual review,
accessibility, and the launch load measured on throwaway containers. Everything that needs live
Render or the live Cloudflare account is
[FC-052 / #1287](https://app.shortcut.com/startrekonlineinfo/story/1287)'s, listed at the end.

## The five criteria

| Criterion | Met by |
| --- | --- |
| All plan §5 Help/navigation journeys pass; campaign help matches FC-041; public/restricted sitemap and feature filtering are correct. | [Journeys](#journeys): `02-help-and-navigation` on desktop and phone, including the sitemap built as the build builds it and every Help address in it opened signed out; switched off and unreachable; `04-owed-admin` drives rescan campaigns against the guide's words. |
| All LCARS shared control/tab/dialog/colour requirements pass build and visual review. | [Visual review](#visual-review): 32 full-page screenshots reviewed tile by tile; every defect on Fleet's pages and the shared controls they use fixed, and the site-wide phone frame with them. `docs/ui-components.md` describes the controls and the Fleet colours as they are. |
| Four-hour/seven-day limits, presence choices and source timezone are clear to users. | Chat's note reads "You can read back the last four hours here." and the transcript dialog its days, both from the server's policy; presence and typing on Settings with their help; the export zone on import and Settings. Checked in `04-owed-chat` and `04-owed-news-activity`. |
| Measured throughput/latency/memory/DB/Redis budgets support agreed launch load. | [Load](#load): every latency, throughput, connection and Redis budget met with room. The backend fits 512 MiB with its heap capped at 384 MiB, the configuration Steve chose for Render; its resident set there is FC-052's to confirm. |
| Accessibility, keyboard and reduced motion pass relevant checks. | [Accessibility](#accessibility): axe (WCAG 2.0/2.1 A and AA) on every Fleet, chat, settings, Help and site admin page, with data in them; keyboard journeys; one global reduced-motion rule. Six defects found and fixed. |

## Steve's decisions

Made on 2 October 2026, before anything was built, all as recommended:

- **Launch load:** 100 Communities, 300 Fleets, 30,000 roster members; 200 chat sockets, 20
  messages a second at peak; 60 imports an hour; a Fleet with 300 exports of 500 rows replayed;
  300 picture scans an hour. Budgets: reads p95 under 500 ms at 50 a second, a 2,000-row check under
  2 s, the largest replay under 60 s, chat delivery p95 under 500 ms, backend under 512 MiB and
  worker under 2 GB, connections inside `operations/render-services.md`.
- **Signed-in journeys** run on the local stack as six disposable people at `fc044.example`, made
  and removed by `e2e:support`; nobody's password is needed and no real member's data is touched.
- **Load runs** are Node scripts on the operations rehearsal's throwaway containers.
- **Accessibility** is WCAG 2.1 AA, with one global `prefers-reduced-motion` rule.
- **Owed checks** from FC-027 to FC-049 are automated and folded in.
- **Mail:** nothing is ever sent to a reserved test domain, in any environment.
- **Chat wording:** "You can read back the last four hours here.", figures from the server.
- **Help while unreachable:** guides stay readable under the Connection Lost notice.
- **Audit:** derived roster rows are no longer written to `_audit`.
- **Client addresses:** only a request carrying Cloudflare's `X-Origin-Verify` secret has
  `CF-Connecting-IP` believed; any other is refused, `/health/` aside.

On 4 October 2026:

- **Chat list:** a Community's Owner, and anyone with a Community-wide role, sees the Community and
  every Fleet and Armada in it.
- **Message actions:** in the Tab order, revealed on focus.
- **Visual fixes:** Fleet's pages and the site-wide phone frame now; Fleet's colours documented as
  they are, the doc's "sky" being `$lcars-sky`, `#aaf`.
- **Form controls:** native checkboxes, radios and file inputs, drawn the LCARS way.
- **Backend memory:** Render's 512 MB plan, heap capped at 384 MiB.

## Defects found and fixed

| # | Defect | Found by | Fixed by |
| --- | --- | --- | --- |
| 1 | **Chat delivery p95 was 1,417 ms** at 20 messages a second: each socket was told in turn, and membership lookups were repeated per message. | Load L7. | `ChatDeliveryService`: parallel delivery, single-flight lookups, a generation bump on `forget()`. p95 now 78 to 106 ms. |
| 2 | **A long replay took 220 s and 214 MB of `_audit`**: one audit row per derived roster row. | Load L4. | `audit.subscriber.ts` leaves derived roster entities out. 37 s. |
| 3 | **Storytime Help vanished while the API was unreachable.** | Journey 02. | Help keeps guides readable under the offline notice; only a switch the server says is off withdraws them. |
| 4 | **Every sign-in mailed the address**, disposable test domains included. | Setting up the journeys. | `reservedMailDomain()`; `MailService` skips and logs them. |
| 5 | **Rate limits keyed on headers any caller could write.** | Reviewing the load script's addresses. | `CloudflareOrigin`: the secret header proves Cloudflare; everything else is refused. |
| 6 | **Chat refused every send, "Chat is closed.", after a sign-in race**: a disconnect before the first open rejected a promise the first open never replaced. | Journey 01. | `ChatSocketService.ready()` starts a fresh wait when it first opens; a spec fails without the fix. |
| 7 | **A Community's Owner saw no chats**, and their Fleet's Chat tab opened an empty page: ownership is not a role row. | Journey 01. | `ChatChannelService.mine()` lists everywhere an Owner or a Community-wide role reaches. |
| 8 | **Reply, Report and Remove could not be reached by keyboard** (`display: none` until hover or focus inside, and a message cannot take focus). | Journey 01 by keyboard. | Clipped rather than hidden, so they stay in the Tab order. WCAG 2.1.1. |
| 9 | **An exact Fleet name used a prohibited `aria-label` on a span**, which screen readers ignore, with every drawn part hidden. | axe. | The name is visually hidden text instead. |
| 10 | **Admin record details were `<dl>`s of spans**, five pages. | axe. | `dt`/`dd`. |
| 11 | **LCARS buttons kept their hover fade under reduced motion**, their `!important` outranking the global rule. | Journey 03. | Named in the reduced-motion rule. |
| 12 | **A Fleet news cover could never be uploaded** ("Database error"), nor, by the same path, Fleet or Armada artwork: the file row named both the Fleet and its Community, and the database allows one. | `04-owed-news-activity`. | `ImageIngressService` names the narrowest scope only, as delivery reads it. |
| 13 | **A refused Community registration never said why.** At the ten-Community limit, or on any other refusal, "Registering the Community" stayed up for good: the OnPush page was never told to redraw. | The phone run, whose Owner reached the limit. | `CommunityRegisterComponent` marks the view on a refusal; a spec with a late answer fails without it. |
| 14 | **The local schema was six migrations behind** (FC-042/043): `start:dev` never migrates. | The backend's own `42P01` errors. | Applied; noted for whoever runs the stack next. |
| 15 | The [visual review](#visual-review)'s defects. | Screenshots. | Below. |

## Load

`npm run rehearse:load` (backend): the operations rehearsal's stack started cold, then L1 to L7 at the
launch load. Run 8, on 2 October 2026, after defects 1 and 2:

| Scenario | Budget | Measured |
| --- | --- | --- |
| S1 cold start | — | Whole stack ready in 49.7 s from `docker start`; `/health/ready` 14.2 s from process start, restore check included. |
| L1 launch scale | — | 300 rosters of 100 imported in 52.3 s (20,650 an hour); 30,000 members. |
| L2 reads | p95 under 500 ms at 50 a second | p50 26 ms, p95 62 ms, p99 79 ms, max 134 ms; all 3,000 answered 200. |
| L3 a 2,000-row check | under 2 s | p95 353 ms; imported end to end in 3.5 s. |
| L4 the largest replay | under 60 s | 37.1 s over 150,100 rows of history. |
| L5 imports | 60 an hour | 60 sent at once, all in force in 12.3 s. |
| L6 picture scans | 300 an hour | 300 accepted in 5.4 s; upload to verdict p95 3.7 s. |
| L7 chat | p95 under 500 ms | 200 sockets, 1,201 messages in 60 s: acknowledged p95 80 ms; 24,020 deliveries, none doubled, p95 106 ms. |
| Connections | inside the plan | Backend at most 10, worker at most 2. Redis at most 27 clients, inside 250 twice over for a deploy. |
| Worker and clamd | under 2 GB | Worker at most 144 MiB, clamd 948 MiB. |
| Backend memory | under 512 MiB | **Not met uncapped**: 440 to 470 MiB under reads and imports, up to 1,001 MiB after L4's replay, with the heap at 775 MiB. With `--max-old-space-size=384` every scenario still passed, the heap at most 322 MiB and the resident set about 550 MiB (Windows working set). |
| Nothing unscanned published | none | None. |

The rehearsal now caps the backend's heap at 384 MiB by default, as production runs it;
`LOAD_BACKEND_HEAP_MIB` sets another cap, and `0` none. Other options: `LOAD_SCENARIOS` (`L4,L7`;
L1 always runs), `REHEARSAL_WORKER_REPO`, `REHEARSAL_RESULTS`.

Run 9, on 2 October, repeated the stack with Cloudflare's origin secret set: a request that bypassed
Cloudflare was refused `403` whatever address it claimed, `/health/ready` answered `200`, and every
load still passed.

**Backend memory:** Steve chose, on 4 October 2026, Render's 512 MB plan with
`NODE_OPTIONS=--max-old-space-size=384`, the configuration every scenario passed under. The resident
set on Render's Linux is FC-052's to measure ([Render services](../operations/render-services.md#the-backend)).

## Journeys

`npx playwright test --project=fleet-desktop --project=fleet-mobile` (frontend), against the local
stack with the backend built rather than watching (its watcher restarted the API twice mid-run on
file events that changed nothing). Results: see [Journey results](#journey-results).

| Spec | Covers |
| --- | --- |
| `01-registration-to-moderation` | Register a Community and Fleets, import a roster, apply and accept, an event, chat, report and resolve, suspend. |
| `02-help-and-navigation` | Plan §5: Help to every section and guide and every page a guide links to; Settings and its guide; Community and the Dashboard to Fleets; following nothing and several; signed out; switched off; unreachable; the sitemap. |
| `03-accessibility` | axe on 37 pages; tabs and a dialog by keyboard; reduced motion. |
| `04-owed-news-activity` | FC-027, FC-029, FC-049. |
| `04-owed-events` | FC-028, FC-030. |
| `04-owed-chat` | FC-031, FC-033, FC-034, FC-035's reports. |
| `04-owed-admin` | FC-036, FC-037, FC-039, FC-041. |
| `05-screenshots` | 16 pages at 1280 px and on a Pixel 7, `docs/screenshots/fc-044/`. |

Still owed, for secrets the local stack does not hold: FC-035's transcript export, FC-038's erasure
and FC-040's private images.

### Journey results

The final run, on 4 October 2026: **173 passed, none flaky**, in 1.1 hours across both projects. The
one skip is the sitemap journey on the phone, which runs on desktop alone.

| Project | Passed |
| --- | --- |
| `fleet-setup`, `fleet-teardown` | 2 |
| `fleet-desktop` (1280 × 900) | 86 of 86, the sitemap included |
| `fleet-mobile` (Pixel 7) | 85 of 86, the sitemap skipped |

Earlier runs found defects 6 to 13 and 15, and four things about running them, each now handled by
the harness and written up in the frontend's `e2e/README.md`: the dev server's watcher restarting
the API; an Owner's ten-Community limit across a desktop and phone run; a session saved once and
retired by the first refresh an hour in; and the local `clamd` never loading `freshclam`'s
signatures, which paused every scan once they were 48 hours old (production's image notifies
`clamd` over TCP and is unaffected).

The gates, the same day: backend 10,087 tests at 100% coverage and 50 fuzz tests; frontend 8,344
tests at 100% coverage, the dev build, type checks and lint; worker 387 tests at 100% coverage.

## Accessibility

- axe, WCAG 2.0/2.1 A and AA, on every Fleet, chat, settings, Help and site admin page, with records
  in them. Defects 9 and 10 were its findings.
- Keyboard: a Fleet's tab strip, a dialog that Escape closes with focus returned, and the chat
  message actions (defect 8), reached by keyboard in journeys 01 and 03.
- Reduced motion: one global rule, checked with and without the setting (defect 11).
- Visible focus restored on checkboxes and radios, which a global rule had taken away.

## Visual review

All 32 screenshots were cut into tiles and reviewed against `docs/ui-components.md`. Fixed:

- The theme's bare-element rules drew Fleet's controls as sidebar parts: the chat list's links as
  210 px violet pills, sortable table headers as 200 px buttons (a 1,850 px roster), two tab strips
  and the Settings switches as buttons, a calendar's month controls capped at 660 px.
- Phone layouts: Settings (its content 90 px wide), the import preview, the directory's cards and
  the stacked tables carried values off the screen; Dashboard Fleets' pills spilled their labels; a
  long bar title overlapped what followed (a new `lcars-text-bar--wraps`).
- Controls: selects in field containers took the browser's grey box; choosers' labels sat on the
  rounded edge; checkboxes and radios were drawn 100% wide; anchor pills were underlined.
- Layout: the directory strip lit Communities on every Fleet page; sections' content was inset
  twice; the Close section's bar was half width; two Settings fields ran together.
- The site-wide phone frame: the header's notice ran one letter to a line, the sidebar's labels
  lost their last letters, the version wrapped out of its panel.

Seen and left: the home page's Storytime card and the Dashboard home's right column on a phone,
both outside Fleet; a Manage Permissions role chosen before the member's details arrive is set back.

## For FC-052

- `NODE_OPTIONS=--max-old-space-size=384` on the backend's 512 MB service, and its resident set
  measured on Render under the same load.
- `cloudflareOriginVerifySecret` in both secrets, the Transform Rules, the `403` probe, and the
  `onrender.com` subdomain switched off.
- FC-042's Gated keys in the dev and prod secrets; the old credentials retired.
- The checks owed for FC-035, FC-038 and FC-040, once their secrets are set.
