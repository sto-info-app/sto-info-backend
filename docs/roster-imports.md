# Roster imports: the privacy boundary

How an STO roster export enters the site, what is thrown away on the way in, and why the thing
that is kept is not the file that was uploaded.

FC-009. See also [File assets](file-assets.md) for the registry the sanitised file lands in, and
ADR-0001 and ADR-0018 in the Fleet Community plans for the decisions behind it.

## The one-sentence version

The three officer columns are discarded before a DTO, a log line, a queue payload, a database row
or a stored byte exists, and what is retained is a canonical twelve-column re-serialisation that
this application wrote itself.

## Why there is a boundary at all

An STO roster export can carry fifteen columns. Twelve of them describe a Fleet member in ways the
member can see: name, handle, level, class, rank, contribution, three dates, status and a public
comment. Three of them do not:

```text
Officer Comment,Officer Comment Author,Officer Comment Last Edit Date
```

Those are private notes Fleet officers wrote about named players. In the analysed corpus they are
present in 868 of 1,199 files and populated on 5,700 rows.

R10 says they are never persisted. An earlier instruction asked for uploaded sources to be kept
for 180 days. Both cannot be honoured literally, and ADR-0001 resolved it: **the later privacy
requirement wins, and the byte-exact upload is never retained.** This document is how that is
implemented.

## What happens to an upload, in order

`POST /fleet-communities/:communityId/fleets/:fleetId/roster-imports`

1. **The feature switch.** `FLEET_IMPORTS_ENABLED` is checked first and answers `404` rather than
   "disabled", so a staged rollout does not advertise what is coming.
2. **The capability.** `roster.import` at that Fleet, checked by `ScopeCapabilityGuard` against
   FC-005's policy. The route is nested under the Community so a Fleet belonging to a different
   Community than the path claims resolves to nothing.
3. **Multer, into memory.** Not disk. Disk storage would write the officer columns to a temporary
   file before any of this application's code had seen them.
4. **The filename.** Checked for length and for characters that cannot be recorded — controls and
   path separators. It is never used to build a storage key.
5. **The source hash.** SHA-256 of the received bytes, computed in memory.
6. **The privacy parser.** Structure validated, officer columns discarded, twelve columns
   re-serialised.
7. **The raw buffer is overwritten with zeroes**, in a `finally`, so it happens on the failure
   path too.
8. **The registry row**, in `RECEIVING`, then the object into the private quarantine bucket, then
   `QUARANTINED` with the sanitised hash bound to it.
9. **The provenance row**, in `fleet_roster_import_source`.

Nothing enqueues a scan, because there is no scanner yet. The asset stays `QUARANTINED` and FC-010
claims it from there.

## The grammar

`RosterCsvPrivacyParserService` is the only thing in the site that ever sees all fifteen columns.
It has nothing injected into it, so there is nothing it could accidentally tell.

### Why not a CSV library

The corpus says none can do it:

- **Strict RFC 4180 rejected 714 of 1,199 real exports.** STO writes literal quotes inside quoted
  free text without doubling them. `"Call me "Renn", not Renner"` is a real public comment.
- **Permissive parsing produced thousands of wrong-width rows**, and a wrong-width row is exactly
  how an officer note slides into Public Comment.

Padding, truncating and zipping values to headers are ruled out for the same reason.

### Anchored at both ends

```text
<nine comma-free fields>,"Status","Public Comment",EditDate
<nine comma-free fields>,"Status","Public Comment",EditDate,"Officer Comment",Author,OfficerDate
```

**Left anchor:** the first nine fields are unquoted and comma-free, verified across all 144,713
corpus rows, so the first nine commas are taken literally.

**Right anchor:** every trailing date field is empty or shaped `M/D/YYYY h:mm:ssam`. This is
load-bearing, not decorative — see [the absorption problem](#the-absorption-problem).

**The officer author and its date are unquoted.** The plan does not record this and a parser that
assumes otherwise gets all 5,700 officer rows wrong. It cost an afternoon the first time.

The officer shape is admissible only under the fifteen-column header, and under that header the
twelve-field shape stays admissible too: 868 officer-headed files contain rows with the tail
simply absent.

### Ambiguity is a refusal

Every candidate boundary is enumerated. A row is accepted only if **exactly one** reading
satisfies the grammar. Two readings mean the bytes do not determine where Public Comment ends, and
choosing either is how officer text gets retained.

All 144,713 corpus rows match exactly one shape. That is a fact about an export tool, not a
guarantee about a file somebody uploads on purpose, which is why FC-001 committed a hand-built
ambiguous fixture.

Candidate readings are held as **positions, not text**. Nothing is sliced out of a row until one
reading survives, so a candidate whose "Public Comment" swallowed an officer note never exists as
a string.

### The absorption problem

Worth writing down because it is the one real trap in this grammar, and the first draft fell into
it.

Consider this row under a fifteen-column header:

```text
...,"Status","Comment",d,"OFFICER NOTE",Author
```

It is not a well-formed fifteen-field row — the officer date is missing. Without a right-hand
anchor it is a perfectly good *twelve*-field row: Status, then a Public Comment of
`Comment",d,"OFFICER NOTE`, then an edit date of `Author`. One reading, no ambiguity, officer note
retained.

Free text can contain anything, so no rule about Public Comment can catch this. The rule has to be
about the field that cannot: **the trailing date is empty or date-shaped**. `Author` is neither,
so the reading fails and the row is refused.

This is also why a well-formed officer row has exactly one reading. Its author and date introduce
a comma into any would-be twelve-field edit date, and an edit date cannot hold a comma.

**The residual.** A file STO did not produce, whose officer author is omitted and whose final
field happens to be date-shaped, can still have its note absorbed into Public Comment:

```text
...,"Status","Comment",,"OFFICER NOTE",3/3/2023 4:00:00pm
```

There is one reading, it is not ambiguous, and the note lands in a retained column. Closing it
would mean forbidding a comma-then-quote sequence inside a public comment, and there is no
evidence the corpus never contains one — 4,694 rows have quotes in Public Comment and 4,207 have
commas, and whether any has them adjacent was never measured. Refusing real exports to close a
hole that needs a hand-crafted file is the worse trade.

What it means in practice: the text lands in Public Comment, where the uploader can see it, where
it is not attributed to an officer, and where FC-016's typed parse gets a second look at it.

### Bounded

| Limit | Value | Chosen against |
| --- | --- | --- |
| Upload size | 2 MiB | Largest corpus file is 79,165 bytes |
| Rows | 2,000 | Largest corpus roster is 500 |
| Line length | 64 KiB | — |
| Retained field length | 4 KiB | A public comment is not four kilobytes |
| Quotes per line | 48 | A well-formed row has 4, or 6 with an officer tail |
| Tail parse steps | 4,096 | A real row costs fewer than ten |

The last two are the ones that matter. The officer shape nests three searches over candidate quote
positions, so a line of alternating quotes and commas would otherwise cost cubically: forty-eight
of them reach fifteen thousand steps, which is why the step budget rather than the quote cap is
what refuses it. The two bounds deliberately overlap.

These are constants, not configuration. A limit an operator can raise during an incident is a
limit that gets raised.

## What is retained

A canonical twelve-column CSV, written by this application's own serialiser:

- **Twelve columns always.** An officer-shaped upload produces bytes identical to a
  twelve-column one. Nothing in the file says officer columns were ever there.
- **Every field quoted**, whether it needs it or not, with internal quotes doubled. Uniform
  quoting is what makes the column count provable rather than argued: the delimiter is the only
  unquoted comma in the file.
- **LF line endings, no byte order mark**, rows in source order.
- **Strict RFC 4180**, so unlike its input it can be read by anything.

A BOM on the way in is explicitly allowed and is not retained.

### Where it goes

Into the private quarantine bucket, under a key built from the asset's own UUID — never from the
filename. Registered as:

| Field | Value | Why |
| --- | --- | --- |
| `kind` | `ROSTER_IMPORT_SOURCE` | What a rescan campaign and the retention job filter on |
| `state` | `QUARANTINED` | Nothing has scanned it |
| `audience` | `RESTRICTED` | **Not** `SCOPE` — see below |
| `storage` | `QUARANTINE` | |
| `fleetId` | the Fleet | Ownership, for cleanup and campaigns |
| `retainUntil` | upload + 180 days | ADR-0001, measured from upload |

**The audience is `RESTRICTED` on purpose.** A scoped audience would make the sanitised CSV
reachable through the generic delivery endpoint by anyone the Fleet's audience policy admits, and
a roster export holds every member's handle and Last Active. Its readers are whoever holds
`roster.source.download`, which is a capability rather than an audience, and the route honouring
it is FC-037's. Until then nothing serves these bytes, which is the correct state for a file no
scanner has looked at.

## What is recorded about the file

`fleet_roster_import_source`, one row per accepted upload. ADR-0001 names what has to survive; the
registry holds the filename and the sanitised hash, and this holds the rest.

| Column | Note |
| --- | --- |
| `assetId` | Unique. One import record per stored object |
| `fleetId`, `uploadedByUserId` | `RESTRICT` and `SET NULL` respectively |
| `originalFilename` | As uploaded. Evidence, not input |
| `declaredContentType` | The `Content-Type` the upload arrived with, exactly as sent. Evidence, believed by nothing |
| `sourceSha256` | Of bytes that no longer exist anywhere |
| `sanitisedSha256` | Of what is in the bucket |
| `sourceByteSize`, `sanitisedByteSize` | |
| `sourceHeaderShape` | `NORMAL` or `OFFICER` |
| `rowCount`, `officerTailRowCount` | Counts, never values |
| `parserVersion` | Bump when the same bytes would give a different file |
| `uploadedAt` | |

**Why keep the source hash when the source is gone.** It is the only evidence connecting an import
to the file somebody actually uploaded — it settles "is this the same export I sent you" and "has
this already been imported" without a byte surviving. A SHA-256 tells nobody anything they could
not compute from a file they already hold.

**Why keep what the browser called it.** A CSV has no magic number, so the `Content-Type` on an
upload is whatever the uploading machine's file association happens to say: `text/csv`,
`application/vnd.ms-excel` and `application/octet-stream` are all common for the same export.
It is worth nothing as a fact about the bytes and something as a record of the upload, which is
why it sits here and not on the registry row. The asset the import registers declares `text/csv`
instead, because the bytes it holds are the sanitised CSV this application wrote —
[ADR-0020](../../../Plans/Fleets/ADR/0020-scanner-health-and-declared-types.md).

**Why record the officer tail count.** It is how an administrator sees how much of the estate is
officer-visible without reading a single note, and it is returned to the uploader so the product
says plainly what it threw away.

**Provenance is write-once**, enforced by `TR_roster_import_source_guard`. The row is the answer to
"what was actually uploaded", and an answer that can be edited afterwards is not evidence. The two
counts stay mutable: a recount is a correction to a derived figure, not to the record of the
upload.

## When an upload is refused

Nothing is kept. No registry row, no object, no provenance row, and **no raw sample** — not in the
response, the log, a dead-letter payload or Sentry. ADR-0001 is explicit about that, and the
failure path is the one that matters, because a rejected upload is exactly the one somebody would
otherwise be tempted to keep a copy of to debug.

The caller gets a structural code and, where one applies, a physical line number counting from
one with the header as line one. Both values were produced by this application; neither was read
out of the file.

| Code | Meaning |
| --- | --- |
| `FILE_TOO_LARGE`, `FILE_EMPTY` | |
| `FILENAME_UNUSABLE` | Empty, too long, or holding a control character or path separator |
| `ENCODING_NOT_UTF8` | A BOM is fine; invalid UTF-8 is refused rather than repaired |
| `CONTROL_CHARACTER` | Tab is allowed. A NUL in a name is not |
| `LINE_ENDING_UNSUPPORTED` | A carriage return not ending a CRLF |
| `HEADER_UNRECOGNISED` | Neither known header, byte for byte |
| `TOO_MANY_ROWS`, `LINE_TOO_LONG`, `FIELD_TOO_LONG`, `TOO_MANY_QUOTES` | |
| `BLANK_LINE` | Other than the file's own terminator |
| `ROW_PREFIX_MALFORMED` | Fewer than nine leading commas |
| `ROW_UNPARSEABLE` | No reading satisfies the grammar |
| `ROW_AMBIGUOUS` | More than one does |
| `ROW_PARSE_BUDGET` | Finding out would cost more than the parser will spend |

Every one describes structure. None describes content, which is what makes it safe to hand back.

## What this deliberately does not do

The parser validates structure and redacts. **It never evaluates content.** Each of these is
FC-016's or FC-017's, and implementing either here would mean two implementations of the same
question with a chance to disagree:

- Whether a level is a number or a date is real. A date of the right *shape* that is not a real
  date is accepted here and refused there.
- Whether the filename matches the anchored grammar, or its Fleet label matches the target Fleet.
- Whether a Character and handle appear twice.
- Anything about timezones.

Of FC-001's five reject fixtures, this ticket refuses two — the bad header and the ambiguous tail.
The duplicate identity, the research filename and the daylight-saving gap are all sanitised
successfully here and refused later, and the parser's specs assert exactly that.

## How it is proved

| Check | What it covers |
| --- | --- |
| `roster-csv-privacy-parser.service.spec.ts` | 73 cases: the grammar, every limit, every rejection code, and all 20 accepted corpus fixtures |
| `roster-import-ingress.service.spec.ts` | Registration, hashing, buffer disposal on all four paths |
| `roster-imports.controller.spec.ts` | Feature switch, missing file, DTO mapping |
| `__tests__/officer-canary-sinks.spec.ts` | Drives the whole ingress and asserts the canary reaches none of six sinks — response, log, stored bytes, registry arguments, database row, thrown error and its stack |
| `__tests__/officer-canary-containment.spec.ts` | Sweeps `src`, `scripts`, `docs`, `config` and `test` for the token outside its six allowed files |
| `roster-csv-privacy-parser.fuzz.spec.ts` | Arbitrary bytes never throw anything but a refusal; officer text never escapes; output is always twelve strict RFC 4180 columns; bounds hold |
| `npm run rehearse:migration:roster-import-source` | 32 assertions and a ten-writer race, against `postgres:18-alpine` |

The canary is the synthetic token FC-001 wrote into its fixtures' officer columns; the fixtures
and the containment spec's allowlist are where it is spelled out, and this document deliberately
does not repeat it. The sink sweep asserts the fixture really does carry it before asserting it
went nowhere, so a pass means the sweep worked rather than that there was nothing to find.

### Adding a file that may name the canary

The containment sweep has a short allowlist and adding to it is a decision, not a fix. If a new
file needs the token, answer why first. In production the thing in that position is a real note an
officer wrote about a named player.

## Changing the parser

A change to the grammar, the limits or the serialiser that would give a **different sanitised file
from the same bytes** is a new `ROSTER_PARSER_VERSION`. Plan §3.3 is explicit that a new locale or
line-break form is a new parser version and a new set of fixtures, never an automatic guess at run
time.

The version is recorded against every import, so an investigator can tell which grammar produced
a given file.

## What is not here yet

- **Nothing scans the sanitised file.** FC-010 builds the job transport, FC-011 the adapter. Until
  then every roster asset sits in `QUARANTINED` forever.
- **Nothing reads it back.** No list endpoint, no download. FC-017 and FC-037.
- **Nothing deletes it.** `retainUntil` is set; the cleanup job is W09's.
- **No typed parse, no snapshot, no observations.** FC-016 and FC-017.
- **No frontend.** FC-009 is backend only.
