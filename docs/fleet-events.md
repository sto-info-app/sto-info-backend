# Fleet events

A Community's, a Fleet's and an Armada's events (FC-028). The code is in `src/fleet/events`. The
decisions below are Steve's, from 28 September 2026. FC-030 builds the pages, the attendance
report and somebody's own list; see [Fleet reports](fleet-reports.md#attendance).

## An event

- **Scope.** A Community's own, a Fleet's or an Armada's, under the same rules as their news.
- **Rule.** Once; every one to twelve weeks on chosen weekdays; or every one to twelve months on a
  day of the month, or on the first to fourth or last of a weekday. It ends on a day, after up to
  500 occurrences, or never. Nothing daily.
- **Time.** A local start time in the timezone the organiser chose, the Community's own by default.
  A series follows that clock across daylight saving: a Friday event at eight is at eight on every
  Friday.
- **Daylight saving.** A time the clock repeats takes the earlier instant; a time it jumps over
  moves forward by the jump, so 01:30 on the morning the clocks go forward becomes 02:30. Each
  occurrence records how it was placed (`adjustment`), and the preview shows every one.
- **Short months.** A monthly event on the 29th to 31st skips a month without that day. The preview
  lists the skipped months. The last of a weekday always exists.
- **Duration** is five minutes to a day. **Capacity** is optional, one to a thousand places.
- **Content.** A title, a Markdown description, and one `https` link, such as a Discord event.

## Occurrences

Occurrences are written out twelve months ahead when an event is created or changed, and a daily
job (02:17 UTC) keeps each running event a year ahead. Each is keyed by the day its rule names, so
an edit that keeps the day keeps the occurrence and its answers.

**An edit changes what lies ahead only.**

- An occurrence that has started is never touched, nor its answers or attendance.
- One still named keeps its answers; if its time changed it moves, remembers when it was first due
  (`movedFromStartsAt`), and whoever is reminded of it is told.
- One no longer named is cancelled, and whoever is reminded of it is told.
- One moved or cancelled on its own is left as it was.
- One the rule names again after an earlier edit dropped it comes back.

A manager may also cancel or move a single occurrence.

Nothing is ever deleted. Cancelling an event cancels everything of it still to come. Closing its
scope does the same, in the closure's own transaction; closing a Community reaches its Fleets' and
Armadas' events too. Held occurrences stay readable.

## Who may do what

| Who | May |
| --- | --- |
| Anybody who may see the scope and the event | See it, how many are Going, Maybe and waiting, and subscribe to reminders |
| The scope's members, and its managers | Also see who answered, by username and Character |
| `events.rsvp` holders it is shown to; anybody signed in, for a public event | Answer it |
| `events.manage` holders | Everything: create, preview, edit, cancel, move, see Can't go, record attendance, read the change log |

`events.rsvp` is a member's by default and `events.manage` an Owner's and Admins'; both can be
delegated. A Community role reaches every Fleet and Armada in it.

**Audiences.** Public; the Community's followers and members; the scope's own members; its Owner,
Admins and Officers; or chosen Fleets and roles. Chosen Fleets must be in the Community, and a
Fleet's own event chooses roles only. The Community's followers and members count the approved
members of every Fleet in it, on a Fleet's or an Armada's event as on the Community's; at a
Community, its own members do too, while a Fleet's own members stay that Fleet's (FC-050, see
[Fleet governance](fleet-governance.md#who-a-communitys-audience-admits)). Managers see every event
of their scope. An event is never shown to somebody who may not see its scope, and every answer
is asked afresh, so leaving a Fleet hides its members' events at once.

## Answers and the waitlist

Going, Maybe or Can't go, with an optional Character of the answerer's own, checked on the server.
One answer per person per occurrence, open until it starts.

Beyond capacity, Going waits for a place; Maybe takes none. When a place comes free, the earliest
waiting gets it and is told, until the occurrence starts. A capacity raised, or removed, gives the
new places out the same way. A capacity lowered takes no place away.

Every change to an occurrence's answers is made under a lock on the occurrence, so two people
taking the last place are decided one after the other. A repeated request finds its answer already
there.

## Attendance

An `events.manage` holder marks each person attended or absent once the occurrence has started.
They may record anybody who answered, or any of the scope's members who did not (FC-030):

- a Fleet's approved members;
- an Armada's: those of the Fleets placed in it now;
- a Community's: those of the Community itself and of every Fleet in it.

The attendance sheet lists everybody who answered, in answer order, then those members by
username. The Character recorded is the one they answered with, while it is still theirs. A
manager never picks another person's. A second record corrects the first. It is kept apart from the answer and never worked out from it. Only managers
and the person see it. It can be recorded after the scope closes.

## Reminders and notices

Somebody subscribes to an event, a one-off or a whole series, to be reminded 15 minutes, an hour or
a day before each occurrence, in any combination. They are also told when an occurrence they would
be reminded of is cancelled or moved. Somebody given a place off the waitlist is told too. All of
it is in-app, under the event reminder category, which they can switch off.

Every notice goes through the notification outbox, `notification_outbox`, which every targeted
in-app notice shares (FC-029). A change writes its notices in its own transaction. Every minute the
outbox's job asks each feature's handler to queue what has come due — for events, the reminders,
in one statement — then sends what is waiting. Before each is sent, it checks again:

- the person still wants event reminders, which the outbox asks itself;
- they may still see the event, which `ScopeEventReminderService`, the events' handler, asks;
- for a reminder, the occurrence is still going ahead, has not started, and the lead is still one
  they asked for;
- for a promotion, the place is still theirs.

A notice no longer wanted is set aside. One that fails is tried again, up to five times.
`dedupeKey` is unique, so nothing is sent twice. A reminder's key is
`EVENT_REMINDER:<occurrence>:<user>:<lead>:<start in epoch seconds>`, so one moved after its
reminder is reminded of again. The link is the event's page below its scope,
`…/events/:eventId`.

## Routes

`:scope` is `fleet-communities/:c`, `fleet-communities/:c/fleets/:f` or
`fleet-communities/:c/armadas/:a`.

| Route | Who |
| --- | --- |
| `GET /:scope/events?from=&to=` | Anybody who may see the scope; the next 31 days by default, at most 93 |
| `POST /:scope/events/preview` | `events.manage`; what a rule would come to over the next year |
| `POST /:scope/events` | `events.manage` |
| `GET /:scope/events/:eventId` | Anybody it is shown to; the rule and the next ten occurrences |
| `PUT /:scope/events/:eventId` | `events.manage`; the whole event, changed from now on |
| `POST /:scope/events/:eventId/cancel` | `events.manage` |
| `GET /:scope/events/:eventId/history` | `events.manage` |
| `PUT` / `DELETE /:scope/events/:eventId/reminders` | Anybody it is shown to, signed in |
| `GET /:scope/events/:eventId/occurrences/:o` | Anybody it is shown to |
| `POST …/occurrences/:o/cancel`, `POST …/occurrences/:o/move` | `events.manage` |
| `PUT` / `DELETE …/occurrences/:o/rsvp` | Those who may answer |
| `GET` / `PUT …/occurrences/:o/attendance` | `events.manage`; the sheet is `{ records, candidates }` |
| `GET /fleet-events/mine` | Anybody signed in; their own next thirty days |

`GET /fleet-events/mine` (FC-030) lists each occurrence still going ahead in the next thirty days
that the caller answered Going or Maybe, is waiting for, or asked to be reminded of. It covers
only events they may still see, each with its event and its scope's name and page, soonest first.

An event or occurrence the caller may not see answers 404, the same as one that does not exist. A
closed scope, a cancelled event or occurrence, or one that has started refuses changes with 409.
Every route is behind the Fleet Community switch.

## The schema

`CreateScopeEvents1795700000000` creates the following tables:

- `scope_event`
- `scope_event_audience_member`
- `scope_event_occurrence`
- `scope_event_rsvp`
- `scope_event_attendance`
- `scope_event_reminder`
- `scope_event_action`

Its notices go in `notification_outbox`, made by `CreateNotificationOutbox1795650000000`.

The constraints:

- `CHK_scope_event_rule` states each kind of rule's shape. Each branch tests the nullable columns it
  relies on, so it never passes by evaluating to NULL.
- Checks bound the interval, duration, capacity and count, and require an `https` link and a
  single end.
- The Fleet, Armada and chosen Fleets are composite with the Community.
- One occurrence per day its rule names, one answer, one attendance and one reminder per person.
- Only Going can wait.
- The change log is write-once by trigger.

The migration was applied, reverted and applied again locally. 28 statements aimed at its
constraints and trigger were each refused or allowed as intended, and five more at the outbox's.
The reminder query queued exactly the reminder due, once, with the key above.
