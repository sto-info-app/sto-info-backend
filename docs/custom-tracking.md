# Custom Tracking

Custom Tracking lets a signed-in user define their own Sections, Tabs and
Fields once for all of their STO Accounts, or once for all of their STO
Characters, and then record a separate value for each Account or Character.

Definitions and values are managed only from Settings. Account and Character
detail pages display the configured information beneath the existing STO data
and offer no editing controls.

This document is the backend contract. The frontend guide lives in the
frontend repository, and user-facing help lives in the wiki.

## Hierarchy

```text
Target scope (ACCOUNT or CHARACTER)
└── Section
    └── Tab
        └── Field
            └── One value per applicable Account or Character
```

A Section belongs to a scope, not to one record. An `ACCOUNT`-scoped Section
appears against every Account its owner has; a `CHARACTER`-scoped one against
every Character.

Scope is fixed at creation and cannot change. So is a Field's type. Both would
strand or silently reinterpret values already recorded, so changing either
means creating a new definition and deleting the old one.

## Field types

Twenty-seven types, described in
`src/custom-tracking/constants/custom-tracking-field-catalogue.constants.ts`.
The catalogue is the single statement of what each type can do — whether it
draws answers from a user-defined option list, whether it permits more than
one, where its default comes from, and whether its values name a timezone.
Every layer reads it rather than switching on the type itself.

Types that differ only in presentation — `TOGGLE` and `CHECKBOX`, `RADIO` and
`DROPDOWN`, `CHECKBOX_LIST` and `MULTI_SELECT`, `MULTI_SELECT` and `TAGS` —
are deliberately separate identifiers. A switch and a tick box mean different
things to the person answering, and since the type is immutable, collapsing
them would make presentation the one property that could never be corrected.

### Where a value lives

Most types store a typed fragment in the `value` JSONB column, shaped by
`custom-tracking-value.interface.ts`.

Four kinds do not:

| Type                                    | Where the answer lives                    | Why                                                                     |
| --------------------------------------- | ----------------------------------------- | ----------------------------------------------------------------------- |
| `RADIO`, `DROPDOWN`                     | `custom_tracking_value_option`, one row   | A foreign key stops an option being hard-deleted while a value names it |
| `CHECKBOX_LIST`, `MULTI_SELECT`, `TAGS` | `custom_tracking_value_option`, many rows | As above                                                                |
| `IMAGE`                                 | `custom_tracking_image_value`             | Cloudflare identifier and alternative text need their own lifecycle     |

Holding those references inside JSONB would have made them invisible to the
database, leaving the retention job with nothing to consult before deleting an
option a live value still points at.

### Exact numbers

Decimal and percentage values, and the bounds constraining them, are carried
as strings and stored in `numeric` columns. JSON has one numeric type and it is
a double: a decimal a user typed exactly would come back having quietly
changed, and a bound that has been rounded is not a bound.

### Dates, times and timezones

| Type                                       | Stored as                            | Timezone               |
| ------------------------------------------ | ------------------------------------ | ---------------------- |
| `DATE`, `MONTH_YEAR`, `YEAR`, `DATE_RANGE` | Calendar values                      | None. Never converted  |
| `TIME`                                     | Wall-clock time plus IANA identifier | Entered zone, retained |
| `DATE_TIME`, `DATE_TIME_RANGE`             | UTC instant plus IANA identifier     | Entered zone, retained |
| `DURATION`                                 | Days, hours, minutes, seconds        | None                   |

A time without a date is not an instant — there is no way to know which day's
offset applies — so it is never converted to UTC.

A complete date-time is converted, and the entered zone is kept beside the
instant. A UTC instant alone cannot reconstruct the local time the user chose,
because the offset differs either side of a daylight-saving change.

`custom-tracking-timezone.utility.ts` does the conversion. It accepts only
`Area/Location` identifiers and `UTC`; abbreviations such as `GMT`, `BST` and
`EST` are refused, because an abbreviation does not say whether summer time
applies. Conversion tries both offsets the zone could be using around that
date and checks each by converting back, which is what distinguishes a real
time from one inside a spring-forward gap. Where a local time occurs twice —
the morning clocks go back — the earlier instant is returned, every time.

Output format belongs to the definition and cannot be overridden per value.
The backend stores and validates; the frontend formats, because the `LOCALE`
time format depends on the viewer.

## Limits

Enforced in both applications. The backend is authoritative; the frontend
applies the same numbers so a user is warned before losing work, never so the
server can trust that they were. See
`custom-tracking-limits.constants.ts`.

| Resource                                  |             Limit |
| ----------------------------------------- | ----------------: |
| Active Sections per scope                 |                10 |
| Active Tabs per Section                   |                10 |
| Active Fields per Tab                     |                25 |
| Active Fields per scope                   |               200 |
| Active plus soft-deleted Fields per scope |               400 |
| Label                                     |    100 characters |
| Description or help text                  |    500 characters |
| Single-line text value                    |    500 characters |
| Markdown value                            | 10,000 characters |
| Options per choice Field                  |                50 |
| Selected options per value                |                50 |
| Image alternative text                    |    300 characters |
| Rating maximum                            |        3, 5 or 10 |

The active-plus-deleted ceiling is what actually bounds storage. Deleted
definitions are kept for the retention period, so a user repeatedly building
and deleting could otherwise accumulate rows without ever exceeding the active
limit.

## Names

Names are unique without regard to case within their immediate parent:

- Section names within a target scope
- Tab names within a Section
- Field names within a Tab
- Option labels within a Field

Uniqueness considers active definitions only. A deleted Section does not
reserve its name.

## Deletion

All deletion in the interface is soft, confirmed, and irreversible from the
user's point of view. There is no undelete.

- Deleting a Section, Tab or Field makes it and its descendants inactive
  immediately, in one transaction.
- The deletion-impact endpoints report what would go before a confirmation is
  shown: how many Tabs, how many Fields, and how many answers are recorded
  against those Fields across every record. The answers are counted separately
  because they are the part that cannot be typed again — a Section can be
  rebuilt from memory in ten minutes, and what somebody recorded against forty
  Characters cannot.
- Deleting an option soft-deletes it. Values that already selected it keep
  displaying its retained label; it cannot be newly selected; a user editing
  such a value may keep the selection or replace it with an active option.
- Definitions, values and their audit records are hard-deleted 180 days after
  soft deletion, by a scheduled job. See [Retention](#retention).
- An option is retained past 180 days for as long as any retained value
  references it. Referential integrity prevents the hard delete regardless.

## Visibility

Every custom definition defaults to `publiclyVisible = false`. Public sharing
is opt-in at every level.

A Field's value is returned publicly only when all of these hold:

```text
User profile is public
AND owning STO Account is public
AND owning STO Character is public   (CHARACTER scope only)
AND Section is public
AND Tab is public
AND Field is public
AND nothing in that chain is deleted
AND nothing in that chain is administratively suppressed
```

A private ancestor suppresses every descendant, whatever the descendant's own
flag says. The chain is enforced in the query and the public mapper, never
only in the frontend.

Turning off profile visibility removes all public custom data immediately
without altering any lower-level configuration.

Public DTOs carry only the definition metadata needed to render what is
visible. Anonymous responses never contain private labels, values, option
labels, image identifiers or video identifiers.

## Public reading

There is no `/custom-tracking` route an anonymous visitor may call. The
permitted projection is delivered inside the Galactic Personnel Registry's own
account and captain responses, as `customSections`, and there is no second way
to reach it.

That is the point. Those two routes already resolve the member, the STO
Account, the captain and the blocks between the viewer and the owner; a
separate custom-tracking route would have to resolve all four again, and a
public endpoint whose gates are a second copy of somebody else's is an
endpoint that will eventually disagree with them. One response also means one
cache entry, so an authenticated and an anonymous representation cannot come
to differ in what they hold.

`CustomTrackingPublicService` nevertheless asks the database for every gate
itself rather than trusting the route that called it — member public and in
good standing, Account public, captain public — before it reads a single
definition. The repetition costs one query on a heavily cached page and is
what makes the projection safe for the next caller as well as this one.

Nothing in that path throws. A visitor entitled to none of it receives an
empty list, which is exactly what an owner who has configured nothing
produces, so a refusal cannot be used to test whether hidden data exists.

A Field whose type is currently switched off — pictures, YouTube videos — is
left out of the projection entirely rather than rendered as an unanswered
Field. An unanswered Field is a statement about the owner's data, and it would
be a false one made to cover a decision of ours.

### Caching

Nothing needs doing for this feature specifically. Every API response carries
`Cache-Control: no-store` and `Vary: *`, set once for the whole application in
`main.ts`, so no shared cache can hold a representation at all — and therefore
none can serve an authenticated one to an anonymous caller. That is what makes
a visibility change take effect on the next request rather than whenever a
cached copy happens to expire.

A crawler is an anonymous caller and nothing more. It reaches exactly what the
chain permits, because the chain is asked of the database on every request; a
combination that has just been made private is refused on the next one.

## Empty values

Each Field configures independently what the owner sees and what the public
sees where a value is absent: hide it, show the label alone, or show the label
with placeholder text. The placeholder itself is shared between the two views;
only the modes differ.

A public empty presentation is reached only after every visibility gate has
already passed, so it can never reveal that a hidden value exists.

The public mode is applied in the projection rather than in the browser. A
Field configured to hide when empty is absent from the response, not merely
undrawn — a Field that reached the page at all would still be in a response
somebody can read. A Tab or Section left with nothing to show goes with it,
so a visitor is never given an empty heading to wonder about.

## Pictures

An image field's pictures are checked by `ImageSlotService`, the same shared
service Storytime's artwork goes through, against the shape the field was
configured with. Only three shapes exist because each has to correspond to a
Cloudflare Images variant that already exists in the dashboard — a variant name
absent from there yields a broken picture rather than an error anybody notices.

| Shape       | Delivered at | Variant           | Encoding |
| ----------- | ------------ | ----------------- | -------- |
| `SQUARE`    | 300 x 300    | `square300`       | PNG      |
| `LANDSCAPE` | 640 x 360    | `cover640x360`    | JPEG     |
| `PORTRAIT`  | 400 x 600    | `portrait400x600` | PNG      |

One picture per field and record, enforced by a unique key rather than by a
service that remembers to check.

Replacing uploads and validates the new picture first, so a failed upload
leaves the existing one in place. The old image is released only after the new
identifier is committed: releasing first would leave a record pointing at an
image that no longer exists, which is worse than leaving one behind that
nothing points at. What happens to the one left behind is
[the deletion queue](#pictures-nothing-points-at).

The crop shape is copied onto the picture rather than read back from the field,
so a later change to the field cannot misdescribe a picture already stored.

Alternative text is required whenever a picture exists. Upload is the only
moment its author certainly knows what it shows.

A picture cannot be set through the ordinary value route. Accepting an image
identifier in a value payload would let a caller point a field at any image in
the Cloudflare account.

The three shapes are published by `GET /custom-tracking/configuration` —
ratio, minimum size, encoding and delivery variant — so the cropper is locked
to what the server actually holds a picture to. A cropper enforcing a different
ratio refuses an upload only after somebody has already chosen and framed it,
and a variant name written down a second time in the frontend is one rename
away from a broken picture nobody sees an error for. The Cloudflare entity tag
is deliberately absent from that response: it is what the picture is filed
under, which is the server's business.

## Retention

Everything soft-deleted is removed from the database for good 180 days later,
by `CustomTrackingCleanupService` inside the nightly cron pipeline.

The 180 days is a constant in `custom-tracking-retention.constants.ts`, not an
environment variable, unlike the site's other retention windows. This one is
published: the content agreement a user accepts and the Privacy Policy both say
180 days, and the number is part of what they agreed to rather than part of how
a deployment is tuned. A variable would let one environment quietly keep data
for longer than the page promised, with nothing to notice the difference.

### The order the sweep deletes in

Most of the foreign keys between these tables cascade, and one — an answer's
reference to the option it selected — restricts. PostgreSQL is free to process
a cascade's branches in whatever order it likes, so deleting a field and hoping
is a coin toss: sometimes the answers go first and the options follow them
harmlessly, and sometimes an option is reached while an answer still points at
it, and the whole night's job fails on a constraint.

`CustomTrackingPurgeService` therefore issues one statement per table, bottom
up:

1. the answers' option selections
2. the answers' pictures — queued for Cloudflare first
3. the answers
4. the options
5. the fields
6. the tabs
7. the sections

Nothing is deleted while something that survives still refers to it.

Each table is asked about its own `deletedAt` rather than its parent's.
Deleting a section stamps every tab and field beneath it at the same moment,
precisely so this query can be per-table: a tab whose only evidence of deletion
was its section's would be invisible to the sweep and would sit in the table
forever.

An option a surviving answer still selects is left where it is and counted as
`retained`. Its label is the only thing that can render that answer, and the
constraint would refuse the deletion anyway — counting it is what turns that
refusal into a decision. It goes on the night the last answer needing it does.

The sweep is bounded to 500 rows per table per run, oldest first. A mass
deletion 180 days ago should not become one very long night; what is left over
is a day older tomorrow and goes then.

### Closing an account

Closing an account hides the member's custom data from the public immediately —
the public projection already refuses a member whose `deletedAt` is set or
whose account is disabled — and the rows go when the closed-account job erases
the member, `CLOSED_ACCOUNT_RETENTION_DAYS` later.

`UserAccountCleanupService` purges Custom Tracking explicitly, before the user
row goes, rather than leaving it to the cascade. The cascade would take the
rows; it cannot take the pictures, which live in Cloudflare. Doing it while the
references still exist is what stops a closed account leaving images behind
that nothing will ever look for again.

## Pictures nothing points at

`custom_tracking_image_cleanup` is a queue of Cloudflare pictures the site no
longer points at. A row is written in the same transaction that drops the
reference and removed once Cloudflare confirms the picture has gone, so the
queue is normally empty.

That order is the whole point. Deleting from Cloudflare first and recording it
afterwards leaves a window in which the site has forgotten a picture that still
exists and still costs storage — and nothing would ever look for it again,
because the only thing that knew about it was the reference just removed.

Five things put a picture in the queue:

| Reason             | What happened                                            |
| ------------------ | -------------------------------------------------------- |
| `REPLACED`         | A newer picture took its place                            |
| `REMOVED`          | Its owner deleted it                                      |
| `RETENTION`        | The retention sweep removed what held it                  |
| `ACCOUNT_CLOSED`   | Its owner's account was erased                            |
| `ABANDONED_UPLOAD` | It reached Cloudflare but the write did not commit        |

The reason is recorded because a queue that only says "delete this" cannot be
reasoned about when it stops draining. A backlog that is all
`ABANDONED_UPLOAD` means the database is rejecting writes after the upload
succeeded; one that is all `RETENTION` means last night's sweep could not reach
Cloudflare at all. Different faults, different fixes.

This is the orphan reconciliation, arrived at from the other end. Listing the
whole Cloudflare account and comparing it with the database would also find
orphans, but it would be a sweep whose correct outcome is deleting things, and
a bug in it deletes pictures people are still looking at. This only ever
deletes what the site itself recorded as finished with.

The nightly pass takes 200 at a time, oldest first, one request at a time —
by the time a backlog exists, Cloudflare is either rate-limiting us or unwell,
and firing two hundred parallel requests at it is how a recoverable problem
becomes an unrecoverable one. After ten consecutive failures a row is reported
at error level rather than warning: that is no longer a transient timeout.

## Moderation

An administrator can suppress a section, tab or field. Suppression hides it
from everybody but its owner, who keeps their data, their account and their
ability to edit what they wrote.

The public projection already refuses anything whose `suppressedAt` is set, at
every level of the chain, so suppressing a section removes everything beneath
it too.

Suppressing a **field** hides it for every account and character at once. That
is what a report about offending content asks for; suppressing one answer out
of forty would leave the other thirty-nine. There is no suppression below field
level for that reason, and none for an option — an option's label is part of
the field that offers it.

The heavier instrument is the existing one: disabling the account through
`/admin/moderation/users/:id/disable` hides everything the member has published
at once, because the projection checks `isAccountDisabled` as its first gate.
Nothing new was needed to connect that.

There is no interface for suppression, and that is a limit rather than an
omission. Reporting an individual section, tab or field was deferred, so
nothing routes a complaint to one; building a console for a queue that does not
exist would be building the wrong thing first. The routes are in
`docs/api-endpoints.md`.

A field's **name** stays in the audit trail; its **answers** do not. Names are
what an investigation needs — an abusively named field is the report — and they
are already what everybody who can see the field can see. Answers are marked
`@RedactFromAudit()`, so a note somebody wrote about themselves is not copied
into a second table with a different retention period and a different set of
readers.

## What is recorded when things go wrong

`CustomTrackingObservabilityService` is the only place Custom Tracking writes
about its own failures. Every parameter it takes is an identifier, a count or a
value from one of our own enumerations. That is the point of it being a class:
there is no parameter that could carry something a user wrote, so no future
edit can start logging somebody's notes about themselves by accident.

| Recorded                         | Why the site-wide HTTP log is not enough        |
| -------------------------------- | ----------------------------------------------- |
| Which ceiling a request hit       | A hundred refusals a minute is only legible as abuse if they are all the same limit |
| Which field type failed validation | One type failing everywhere is our bug; many types failing for one member is probing |
| The class of an upload failure    | Distinguishes a refused crop from Cloudflare being down |
| What the cleanup jobs did         | Nothing else reports on work that happens when no request is in flight |

The reason a value was refused is deliberately not recorded. Every sentence
validation produces names the rule and some quote the configured bound, and
none of that is worth the risk of one of them one day quoting the value.

## Published policies

The Terms of Use and the Privacy Policy both need wording about this feature
before it is switched on: what a member may record, that public custom content
is published in the ordinary way, that personal information is prohibited in
it, that deleted data goes after 180 days, and that an administrator may hide
content without deleting it.

That wording is drafted in
[custom-tracking-policy-changes.md](./custom-tracking-policy-changes.md)
and has deliberately not been published. Editing the live pages moves their
effective date and changes what members are legally told, which is the site
owner's decision rather than an implementation detail.

## Releasing it

The deployment order, the migration rehearsal and the rollback are in
[custom-tracking-release.md](./custom-tracking-release.md). The short version:
the switch ships off, backend and migrations go first, the frontend second, and
turning the switch off again is the whole rollback for almost any problem.

## Content agreement

`custom-tracking-agreement.constants.ts` holds the wording;
`custom-tracking-policy.constants.ts` holds the version and dates. They live
together so wording and version can only change as one — a version raised
without a text change, or a text change without a version bump, would leave an
acceptance record that does not say what was agreed.

- No definition or value may be created before the current version is
  accepted.
- Raising the version blocks creating and editing definitions and values until
  the user accepts again. Existing data stays readable throughout.
- The acceptance checkbox is never preselected.
- One acceptance per user covers both target scopes.

The wording does not claim that prohibited content can be prevented. Free text
and uploaded pictures cannot be made to refuse personal information, and an
agreement implying otherwise would misstate what the site can do.

## Feature switches

| Switch                                       | Where               | Default |
| -------------------------------------------- | ------------------- | ------- |
| `CUSTOM_TRACKING_ENABLED`                    | `app_setting` table | Off     |
| `CUSTOM_TRACKING_PUBLIC_READ_ENABLED`        | Environment         | On      |
| `CUSTOM_TRACKING_DEFINITION_EDITING_ENABLED` | Environment         | On      |
| `CUSTOM_TRACKING_VALUE_EDITING_ENABLED`      | Environment         | On      |
| `CUSTOM_TRACKING_IMAGES_ENABLED`             | Environment         | On      |
| `CUSTOM_TRACKING_YOUTUBE_ENABLED`            | Environment         | On      |

The master switch is in the database so the feature can be taken offline
during an incident without a deployment. The capability flags stage a rollout
and vary by environment. A disabled capability answers `404`, not a "disabled"
error, so a staged rollout does not advertise what is coming.

## End-to-end journeys

Eleven journeys through the whole feature live in the frontend repository, at
`sto-info-frontend/e2e`. They drive a real browser against this backend and a
real database — no stubs — because what they exist to answer is whether the
browser, the server and the database agree, and a stub answers that the way it
was written to.

Three things a journey cannot do through a browser, and they are the only
reason this repository has anything to do with them:

- switch the feature on, because there is no screen for it;
- make an accepted agreement look out of date, because the current version is a
  compile-time constant that cannot move while the app is running;
- make a deletion look 180 days old, because waiting is not a test.

`npm run e2e:support -- <command>` does those, using this application's own
connection and secrets. It lives here rather than in the harness so that the
harness needs no database credentials, and so that no test-only route exists on
a running server for anybody to find. Where a command has a real service behind
it — purging a member's data, running the retention sweep — it calls that
service rather than writing its own SQL: a rehearsal of a job that is not the
job proves nothing.

| Command                            | What it does                                    |
| ---------------------------------- | ----------------------------------------------- |
| `begin <email>`                    | Switch the feature on; clear that member's data. |
| `finish <email>`                   | Clear it again; switch the feature off.          |
| `flag on\|off`                     | The master switch on its own.                    |
| `reset <email>`                    | The account-closure purge, for one member.       |
| `stale-acceptance <email>`         | Make their acceptance look like an old version.  |
| `age <email> <days>`               | Backdate everything they have deleted.           |
| `disabled <email> on\|off`         | Disable or re-enable their account.              |
| `cleanup`                          | Run tonight's retention job now.                 |
| `counts <email>`                   | What they hold, live and deleted.                |

The picture journey is the only one that reaches outside the machine it runs
on — the file is scanned by a third party and stored in Cloudflare Images — so
it is skipped unless `E2E_IMAGES=on` is set.

## Not built

Deliberately excluded from this delivery:

- Import and export of definitions, values or images, in any format
- Reporting an individual custom Section, Tab, Field or value
- User-facing restoration of deleted definitions or values
- Moving a definition between Account and Character scope
- Changing a Field's type after creation
- Editing values from Account or Character detail pages
- Remembering which Sections a viewer had collapsed
