# Fleet chat

Chat for Communities, Fleets and Armadas, and between friends (FC-031), its live socket (FC-032),
mentions, replies and notices (FC-033), blocks, presence and typing (FC-034), transcripts and
reports (FC-035), and site administrators' holds on its evidence (FC-036). The code is in `src/fleet/chat`. The decisions below are Steve's, from 28 and 29
September 2026. The page itself is the frontend's (`/chat`), as is the site admins' queue of
reports (`/admin/chat-reports`).

- [Who takes part](#who-takes-part)
- [Channels](#channels)
- [Conversations](#conversations)
- [Messages](#messages)
- [Mentions, replies and notices](#mentions-replies-and-notices)
- [Blocks, presence and typing](#blocks-presence-and-typing)
- [Transcripts and reports](#transcripts-and-reports)
- [Holds](#holds)
  - [The hold ledger (FC-042)](#the-hold-ledger-fc-042)
- [Routes](#routes)
- [The socket](#the-socket)
- [The schema](#the-schema)

## Who takes part

Chat is for members, never for followers.

- **A Fleet's member** takes part in its own channels, its Armada's, and its Community's.
- **A Community** counts its own members and the approved members of every Fleet in it. A Fleet
  member posts there on the strength of `chat.post` at any of their Fleets.
- **A role** (Officer, Admin, Owner) reaches further, into the channels kept for it.
- **`chat.post`** lets somebody post. **`chat.moderate`** (Admin and Owner) runs a scope's
  channels and removes messages. A suspension takes both away.

Every answer is asked afresh at every read and post. So leaving a Fleet, a suspension, or a Fleet
leaving its Armada closes the door at once. A scope somebody takes no part in reads as not found,
the same answer as a scope that does not exist.

## Channels

- **One standard channel per scope**, called General, for all its members. It is made the first
  time anybody lists the scope's channels, and a unique index keeps it to one however many ask at
  once. It cannot be renamed or archived.
- **Up to three custom channels per scope**, added by its `chat.moderate` holders while it is
  open. Each names the least role that may read it and the least that may post. Posting defaults to
  reading and may never be open to more people than reading.
- **The ceiling is the database's.** A trigger takes the scope's advisory lock and counts the live
  custom channels, so two creations at once cannot make a fourth. A fourth is refused as a conflict.
- **Twelve at most, inherited.** A Fleet member in an Armada reads up to three standard channels
  and nine custom ones: the Community's, the Armada's and the Fleet's. `/chat/channels` lists them
  all.
- **Names** are 1 to 50 characters, trimmed, and unique within a scope while live, ignoring case.
- **Nothing is deleted.** A custom channel is archived: nobody reads or posts in it again, and a
  new one may take its place.
- Every creation, change and archive is logged to `chat_action`, with the name and roles a change
  replaced.

## Conversations

Only between two friends: there is no group route.

- Opening one needs an accepted friendship and no block either way. A pair has one conversation
  however many times either opens it.
- Whether they may use it is asked at every read and post. Once they stop being friends, or either
  blocks the other, it is closed and its history hidden. Becoming friends again opens it with only
  the last four hours to read, as ever.
- A closed conversation answers as not found, so a block's existence is never told.

## Messages

- **Plain text**, 1 to 2,000 characters.
- **Once per client ID.** The client chooses `clientMessageId`, a UUID. A resend with the same ID
  is the same message, and a race between two sends of it resolves to the one that landed first.
  The same ID used in another place is refused.
- **Ten in any ten seconds** per person, across every place. The eleventh is refused with 429.
- **Four hours back.** Nothing older than four hours is ever read, by page, cursor, search or ID
  (R22). A page is fifty messages, oldest first. `before` carries on backwards and gives the cursor
  for the page before while the page is full. `after` reads newer messages. The cursor is
  `<ISO instant>_<message ID>`. `q` finds words in the window, literally, leaving deleted messages
  out.
- **Deleting.** Authors delete their own. A scope's `chat.moderate` holders remove anybody's in
  its channels, with a reason, logged as `MESSAGE_REMOVED`. Nobody removes the other person's in a
  conversation. A deleted message keeps its place with no text. There is no editing.
- **Removed, not deleted (FC-050).** A message answers `removed: true` when somebody other than its
  author deleted it, a moderator or a site admin, so that its readers see "Message removed by a
  moderator" rather than "Message deleted". An author who deleted their own and then closed their
  account still reads as a deletion.
- **Kept 45 days**, or `CHAT_RETENTION_DAYS`. A daily job (04:23 UTC) forgets anything older, a
  batch at a time, and records each run; see [Fleet retention jobs](fleet-retention.md).

## Mentions, replies and notices

Messages stay plain text (FC-033): nothing is rendered as Markdown or HTML, and there are no
attachments, reactions, group conversations or threads.

- **Mentions.**
  - The text keeps `@Username` as typed. The browser sends, with the message, the IDs of the
    people picked from its list.
  - The server keeps only those who can read the place now: in a channel, anybody its read role
    admits; in a conversation, the other person. The writer never counts.
  - A message lists who it mentions, by username. The page marks only those. Any other `@name`
    stays plain text, and there is no `@everyone` or role mention.
  - The list comes from `GET /chat/channels/:channelId/people?q=`: up to ten others who can read
    the channel, by the start of their username.
- **Replies.** `replyToMessageId` names a message in the same place, within the four-hour
  window, not deleted; anything else is refused (400).
  - A reply shows what it answers, read afresh at every read with the same window: its author and
    its first 80 characters (an emoji counting as one), with `…` when longer.
  - Once the answered message is deleted, older than the window or gone, the reply shows only its
    ID. The page writes "Earlier message", so an old reply never shows older text.
  - A deleted message shows neither its mentions nor what it answered.
- **Notices**, through the notification outbox (`CHAT_MENTION`, `CHAT_REPLY`,
  `CHAT_DIRECT_MESSAGE`), each queued in the transaction posting the message:
  - **A mention:** one to each person mentioned.
  - **A reply:** one to the answered message's author, unless they are also mentioned (one notice,
    not two) or answering themselves.
  - **A direct message:** one to the other person, only if the conversation has not told them
    since they last opened it. `lowNoticedAt` and `highNoticedAt` record that, and reading the
    conversation clears the reader's. At delivery, if they have chat open anywhere, the notice is
    set aside and the conversation may tell them next time. So nobody is told while reading along,
    and somebody away is told once per conversation.
  - Each is checked again at delivery: the message still there, not deleted and within the window,
    and the person still able to read its place. The person's own preference for mentions,
    replies or direct messages is the outbox's to ask.
  - **No quoting.** A notice outlives the window, so it names who wrote and where, and links to the
    channel or conversation, but never quotes the message.

## Blocks, presence and typing

FC-034. Nothing here ever says there is a block, or why.

- **Blocks** work both ways, in every place two people share:
  - **Messages hidden.** Each side's messages reach the other as `hidden`, with nobody and nothing
    in them: no author, text, mentions or reply. This holds live and when reading back. The page
    writes "Message from a member you can't see", so a thread still makes sense.
  - **No quoting.** A reply shows nothing of a message from the other side.
  - **No mentions or replies.** A mention of the other side is dropped, and a reply to them is
    refused. The mention list leaves them out.
  - **Nothing else crosses.** A notice about the other side is set aside at delivery. Neither sees
    the other typing or online.
  - **Direct messages close**, as FC-031 says.
- **Changes take effect at once, on every instance.** `ChatAccessWatcher` watches, through
  TypeORM:
  - the rows that decide who reads what: memberships, role assignments and Armada placements;
  - friendships and blocks;
  - chat preferences.
  - A change made in a transaction is held until it commits, and dropped if it rolls back. Once
    committed, delivery forgets what it knew of the people named, on every instance
    (`chat:revoke`), and checks their sockets again at once. A socket that may no longer read a
    place leaves it and is sent `removed`.
  - A change naming nobody (an update by conditions, or an Armada placement) has every socket
    checked again. These are rare.
  - So a Fleet leaving its Armada, a member leaving or being removed, a role ending, unfriending
    and blocking all take effect before the next message.
  - A change made by raw SQL, outside TypeORM, is not heard. It takes effect within five seconds,
    when the cached answers run out.
- **Presence** means having STO Info open, never a guess about the game. Every signed-in tab holds
  a chat socket while chat is on.
  - **How long.** A socket marks its person online in Redis (`chat:presence:<user>`, 60 seconds)
    when it says who it is, and again at each heartbeat (every 30 seconds). The key goes when their
    last socket closes, and expires by itself if an instance dies.
  - **Who sees it** is each person's choice (`presenceVisibility`):
    - everybody;
    - friends (the default);
    - or friends and anybody sharing a Fleet with them, or a Fleet in the same Armada.
  - **Hidden.** Appearing offline hides it from everybody, and takes them offline at once. Nobody
    across a block ever sees it.
  - **Asking.** `GET /chat/presence?usernames=` answers up to fifty. Anybody the caller may not see
    is simply not online, so the answer tells nothing of anybody's choice.
- **Typing.** `typingIndicatorsEnabled` is off by default, and it works both ways: somebody with it
  off sends no typing signal and is sent none.
  - The browser says a reader is writing at most every three seconds a place, and shows a writer
    for five seconds after their last signal, or until their message arrives.
  - It goes only to readers of the place who have it on and are not across a block from the
    writer.
- **Notices on the page.** A new direct message, or a mention in a channel, is also sent to the
  person's own sockets (`notice`) wherever they are on the site. The page shows it as a toast
  unless that place is open. It says who and where, never what.

## Transcripts and reports

FC-035, with Steve's decisions of 28 and 29 September 2026.

- **Who exports.** `chat.transcript.export` holders at a channel's own scope — its Admins and
  Owner, by default — export that channel. Nobody exports a conversation between friends, a
  sibling Fleet's channel, or a Community's channel on the strength of a role at one of its Fleets.
  `mayExport` on each scope in `/chat/channels` says where the reader may.
- **What.** One channel, over a range within the last seven days, with a purpose of 10 to 500
  characters.
  - The range is checked against the server's clock, and again by the database
    (`CHK_chat_transcript_range`), so no client can widen it. An end in the future is taken as
    now.
  - The purpose is kept, logged and printed in the transcript's header. The request is logged
    (`TRANSCRIPT_REQUESTED`) with its range.
- **How.** A job on the `chat-transcript` queue writes it, asking again first whether the
  requester may still export the channel.
  - It is plain text. A header gives the scope, the channel, the range, the purpose, who asked and
    when it was written. Then one line a message: `YYYY-MM-DD HH:mm Name: text`, in UTC.
  - A deleted message is `[deleted]`, never its text. Somebody across a block from the requester
    is hidden, as chat hides them.
  - It goes to the private exports bucket (see [Infrastructure](infrastructure.md)), under
    `<environment>/chat-transcripts/<id>.txt`, marked `no-store`. The requester gets an in-app
    notice, and it shows in their transcripts on the chat page.
- **Download.** Only its requester, for 24 hours. Each time, the server asks again whether they
  may export the channel. The answer is sent `Cache-Control: no-store, private`, as an
  attachment, and each download is logged (`TRANSCRIPT_DOWNLOADED`).
  - An expired link answers 410, one not yet written 409, one no longer theirs to export 403.
- **Sweep.** Hourly, expired transcripts are deleted from the bucket and marked `EXPIRED`. Any
  still waiting after an hour is marked `FAILED`.
- **Outcomes (FC-039).** The chat log records a transcript being written (`TRANSCRIPT_READY`),
  given up on (`TRANSCRIPT_FAILED`) and expiring (`TRANSCRIPT_EXPIRED`), by the system. Each moves
  the transcript only from where it must be, and is keyed `<action>:<id>`, so a retried job or a
  second sweep writes nothing twice.
- **Reports.** Any reader holding `content.report` where the message is (members, by default)
  reports it to the site's admins, with one of the member reports' reasons. Details of up to 1,000
  characters are optional, but "Something else" needs them.
  - `mayReport` on each channel says where the reader may.
  - Either side of a conversation may report, even once it has closed: a block is the likeliest
    reason to report, and closes it.
  - Once per person per message (409 after that). Not their own message, and not one already
    deleted.
  - The reporter is thanked and never told the outcome.
- **Evidence.** The reported message and the twenty before it in its place are copied when
  reported (`chat_report_evidence`), with their authors' usernames.
  - A message deleted before the report is held without its text. Deleted text is kept only when
    the report came first.
  - The copies outlive the ordinary purge. They are read only through the site admins' routes.
- **The queue.** `/admin/chat-reports`, for the site's ADMIN role alone. Scope moderators never
  see chat reports, and so never a report about a conversation.
  - An admin resolves (`ACTIONED`) or dismisses (`DISMISSED`) a report, with a note of up to 1,000
    characters. The note is required (FC-039): it is the decision's reason in the site admin log.
    Chat reports never sit under review.
  - An admin may remove the reported message. That is logged (`MESSAGE_REMOVED`, naming the
    report), and in the site admin log as `CHAT_MESSAGE_REMOVED` so the Security Log shows it
    (FC-050). Readers are told live, and the evidence keeps what it said.
- **Retention.** A closed report and its evidence are deleted 90 days after it closed, daily,
  unless a site administrator holds it (FC-036).
- **Linked queues (FC-036).** Each chat report says how many open member reports there are about
  its author, and each member report how many open chat reports about the member. Disabling an
  account closes the open chat reports about them as actioned, as it does their member reports.
  `GET /admin/moderation/open-counts` gives both queues' open counts for the Admin page.

## Holds

FC-036, plan section 9 and Steve's decisions of 29 September 2026 (`src/fleet/chat/holds`).

- **What.** A site administrator holds a chat report's evidence past its 90 days, or everything
  one member wrote in chat — every channel and conversation, direct messages included — past the
  45-day purge. One hold in force per report and per member.
- **How long.** Each has a reason, an owner (who placed it) and a review date at most 180 days
  ahead (180 by default). It is extended with a reason, and ends when released, with a reason.
- **Past review (FC-037).** No hold runs on unreviewed.
  - When its review date passes, its owner is told.
  - Seven days before release, every site admin is told.
  - Fourteen days after the date, unless somebody has extended it, the system releases it. The
    release is logged with no actor.

  See [Fleet retention jobs](fleet-retention.md#holds-past-review).
- **The purges.** The message purge leaves a held member's messages, and the report purge a held
  report. Released, what it kept goes with the next purge, as if never held. A hold has no key to
  its report, so its record outlives what it held.
- **Reading.** What a hold keeps is read only through `/admin/moderation-holds/:id/read`, by site
  administrators, each time with a purpose of 10 to 500 characters. A member's messages come
  newest first, fifty a page, deleted text included and marked deleted, with where each was.
  Nobody else, scope moderators included, sees them.
- **The log.** `moderation_hold_action` (write-once) records every placing, extension, release
  and reading, with its reason or purpose, who, and when.

### The hold ledger (FC-042)

Steve's decisions of 30 September 2026. A restore from a backup taken before a hold was placed
would let the purge take what it keeps; one taken before a release would keep what should go. So
every placing, extension and release — the system's automatic release included — is also written
to a ledger outside the database, before the database, in the same step that logs it.

- **Where.** One object per event in the private quarantine bucket:
  `<NODE_ENV>/hold-ledger/<createdAt>_<actionId>_<PLACED|EXTENDED|RELEASED>.json`. The action ID is
  the log row's own: the service makes it before it inserts the row.
- **What.** `{ actionId, holdId, kind, holdKind, chatReportId, subjectUserId, ownerUserId,
  reviewAt, createdAt }`: IDs, dates and the event, with `reviewAt` as the event left it. No
  reason. Readings and the system's notices are not in it.
- **Brought back.** At every boot, the restore check (see
  [Privacy: erasure](privacy-erasure.md#the-restore-check-fc-042)) brings back, oldest first, each
  event the log lacks, under its own ID and time, with no actor, marked automatic, and the reason
  "Brought back from the hold ledger after a restore.":
  - **Placed:** the hold is made again with its own ID and that reason, if its report or member is
    still there; its owner too, if their account is. Otherwise there is nothing left to hold. A
    hold still in the database, or another in force on the same report or member, counts as held.
  - **Extended:** its review date is set, if it is still in force.
  - **Released:** it is released, at the time it was, if it is still in force.
- **Failures.** A marker whose transaction then failed is brought back at the next boot, so the
  ledger errs towards keeping evidence. If the ledger cannot be written, the action fails and
  nothing is logged.

## Routes

Every route needs somebody signed in and the `FLEET_CHAT_ENABLED` switch, as does the socket.
The site admins' chat-report routes need the ADMIN role instead of the switch, so reports made
before chat was switched off can still be closed.

| Method | Path | Who |
| --- | --- | --- |
| `GET` | `/fleet-communities/:communityId/chat/channels` | Anybody who takes part in the Community's chat |
| `POST` | `/fleet-communities/:communityId/chat/channels` | Its `chat.moderate` holders, while it is open |
| `PATCH` | `/fleet-communities/:communityId/chat/channels/:channelId` | Its `chat.moderate` holders, while it is open |
| `POST` | `/fleet-communities/:communityId/chat/channels/:channelId/archive` | Its `chat.moderate` holders, while it is open |
| | The same four under `/fleet-communities/:communityId/fleets/:fleetId/chat/channels` | The same, at the Fleet |
| | The same four under `/fleet-communities/:communityId/armadas/:armadaId/chat/channels` | The same, at the Armada |
| `GET` | `/chat/channels` | Anybody: every scope's channels they may read |
| `GET` | `/chat/channels/:channelId/messages` | Anybody who may read the channel |
| `POST` | `/chat/channels/:channelId/messages` | Anybody who may post in it |
| `GET` | `/chat/channels/:channelId/people?q=` | Anybody who may read the channel: others who can, to mention |
| `GET` | `/chat/presence?usernames=` | Anybody: who of up to fifty people is online, as the caller may know it |
| `GET` | `/chat/messages/:messageId` | Anybody who may read its channel or conversation |
| `DELETE` | `/chat/messages/:messageId` | Its author, or a moderator of its channel with a reason |
| `GET` | `/chat/direct` | Anybody: their conversations still open to them |
| `POST` | `/chat/direct` | Anybody, naming a friend by `userId`, or the `friendshipId` a public profile gives |
| `GET` | `/chat/direct/:conversationId/messages` | Its two, while they may talk |
| `POST` | `/chat/direct/:conversationId/messages` | Its two, while they may talk |
| `POST` | `/chat/messages/:messageId/report` | A reader with `content.report` there, or either side of its conversation |
| `POST` | `/chat/channels/:channelId/transcripts` | A `chat.transcript.export` holder at the channel's own scope |
| `GET` | `/chat/transcripts` | Anybody: the transcripts they asked for in the last day |
| `GET` | `/chat/transcripts/:transcriptId/download` | Its requester, while they may still export the channel, for 24 hours |
| `GET` | `/admin/chat-reports?status=&reason=&page=&pageSize=` | The site's admins: the queue, oldest first |
| `GET` | `/admin/chat-reports/:reportId` | The site's admins: a report with its evidence |
| `POST` | `/admin/chat-reports/:reportId/decision` | The site's admins: `{ status: ACTIONED \| DISMISSED, note }` |
| `POST` | `/admin/chat-reports/:reportId/remove-message` | The site's admins: `{ reason }` |
| `GET` | `/admin/moderation-holds?active=` | The site's admins: holds, due reviews first |
| `POST` | `/admin/moderation-holds` | The site's admins: `{ kind, chatReportId? \| subjectUserId?, reason, reviewAt? }` |
| `GET` | `/admin/moderation-holds/:holdId` | The site's admins: a hold and its log |
| `POST` | `/admin/moderation-holds/:holdId/extend` | The site's admins: `{ reviewAt, reason }` |
| `POST` | `/admin/moderation-holds/:holdId/release` | The site's admins: `{ reason }` |
| `POST` | `/admin/moderation-holds/:holdId/read` | The site's admins: `{ purpose, before? }`, logged |

- A channel is `{ id, kind, name, readRole, postRole, mayPost, mayManage, mayReport }`. Its input
  is `{ name, readRole, postRole? }`.
- `/chat/channels` lists `{ kind, name, path, target, mayCreate, mayExport, channels }` per scope:
  Communities first, then Armadas, then Fleets.
- A report is `{ reason, details? }`. A transcript request is `{ fromAt, toAt, purpose }`, and a
  transcript `{ id, channelId, channelName, scopeKind, scopeName, purpose, fromAt, toAt, status,
  messageCount, createdAt, readyAt, expiresAt }`.
- A message is `{ id, channelId, conversationId, author, body, clientMessageId, createdAt,
  deleted, mine, mentions, replyTo }`, where `replyTo` is `{ id, author, excerpt }` or null. A
  page is `{ messages, before }`.
- A post is `{ body, clientMessageId, mentions?, replyToMessageId? }`, over HTTP or the socket.
- A conversation is `{ id, other: { userId, username } }`.
- A removal takes `{ reason? }`. People are named by username and nothing else.

## The socket

Messages arrive live over a socket.io socket (FC-032): namespace `/chat`, path `/chat/socket`,
WebSocket only. The browser's side is `ChatSocketService` in the frontend.

- **Who.** The first message is `auth` with `{ token }`, the access token, never in the address.
  It is checked as the HTTP API checks it. A socket that has not sent it within five seconds is
  closed. The browser sends a fresh token a minute before the old one runs out. A socket whose
  token runs out anyway is sent `expired` and closed. A fresh token for another person closes it.
  Every event after `auth` asks again that the account is still in use.
- **Five a person.** A sixth socket sends the oldest `replaced` and closes it. That tab does not
  reconnect by itself.
- **Joining.** `join` with `{ channelId }` or `{ conversationId }` joins the place's room, then
  answers with a page:
  - the latest page;
  - or, with `after` (the cursor of the last message held), everything since, fifty at a time. A
    full page means ask again over HTTP.
  - The room is joined before the page is read, so nothing falls between them.
  - A place that may not be read answers as it does over HTTP, and the room is left again.
  - `leave` leaves it.
- **Sending.** `send` with the place, `body` and `clientMessageId` goes through the same service as
  HTTP: the same checks, rate and dedupe. It is acknowledged only once the message is committed.
  The browser sends again with the same ID until it is acknowledged, so a dropped connection
  neither loses nor doubles a message. Posting and deleting over HTTP are delivered live too.
- **Delivery.** Each instance tells its own sockets in the place's room, and passes the message to
  the others through the Redis adapter (`chat:fanout`). Before telling a socket, it asks whether
  its reader may still read the place, as at any read: account in use, membership and role,
  friendship, blocks. It trusts the answer for five seconds at most. A socket that may not is sent
  `removed` with the place and leaves the room. Delivery is at least once; the browser keeps one
  copy of each message ID.
- **Events from the server:**
  - `message`: a message, with `mine` for that reader, `hidden` across a block;
  - `deleted`: the place, `messageId`, and `removed` when somebody other than its author deleted it
    (FC-050);
  - `removed`: the place;
  - `typing`: the place and who (FC-034);
  - `notice`: a direct message or a mention for the reader, wherever they are (FC-034);
  - `expired` and `replaced`.
- **Events from the browser**, besides `auth`, `join`, `leave` and `send`:
  - `heartbeat` every 30 seconds;
  - `typing` with a place, which the socket must have joined (FC-034).
- **Answers.** Every event is answered `{ ok: true, data }` or
  `{ ok: false, error: { status, message } }`, with the HTTP status the same refusal would have.
  Nothing logs a payload or a token.
- **Losing nothing.** Nothing is kept in Redis that the database does not hold. A reconnect after a
  deploy, a crash between commit and fan-out, or a dropped network joins each place again from the
  last message held. It reads what it missed, within the four-hour window, with the checks asked
  afresh. It may land on any instance.
- **Origins.** Only the site's own origins may open the socket, the same list CORS allows, or a
  script with no origin. The token still decides who it is.

`ChatIoAdapter` makes the server with the Redis adapter, taking two more Redis connections an
instance, and closes them with the application. It is set up in `main.ts`.

### The rehearsal

`npm run rehearse:chat-socket [-- --load 40]` starts two chat instances on this machine (ports
3101 and 3102), sharing the local Redis, and checks the protocol over real sockets.

- It makes throwaway accounts in the local database: members of the Fixture Public Fleet, one an
  Officer, two of them friends. Everything it made is removed at the end.
- The accounts speak through rehearsal tokens that only its instances accept (`instance.ts`), so
  nobody is signed in. Everything past the token is the real code.
- It refuses to run against a database that is not on this machine.

On 28 September 2026 all 22 checks held:

- acknowledgement after commit, delivery across instances, and a resend being one message;
- an unsigned socket refused, then closed at five seconds; a bad token refused;
- a token running out closing its socket, and a fresh one keeping it open;
- somebody else's token closing the socket, and the token in no URL and no log line;
- a sixth socket pushing out the oldest;
- a stranger unable to join;
- a narrowed channel sending a member away without the message, and an ended friendship closing
  a conversation;
- after a crash, and after a graceful shutdown, a reconnect to the other instance reading what it
  missed.

Under load: 40 people, a socket each split between the instances, ten posting within the rate for
twenty seconds. That was 158 messages and 6,320 deliveries, with none lost, doubled or refused.
Acknowledgement took 19 ms at p50 and 60 ms at p95. Delivery took 23 ms at p50 and 311 ms at p95;
the tail is the permission checks renewing. Redis peaked at 42 clients across everything running.
The run on Render is FC-052's.

## The schema

`CreateChat1796000000000` makes four tables and the enum types `chat_channel_kind_enum` and
`chat_action_kind_enum`.

- **`chat_channel`**:
  - `CHK_chat_channel_scope` allows a Fleet or an Armada, not both.
  - `CHK_chat_channel_standard` keeps a standard channel open to members and never archived.
  - `CHK_chat_channel_post_role` keeps posting no looser than reading, by the role enum's order.
  - `CHK_chat_channel_name` refuses a blank name.
  - `UX_chat_channel_standard` makes one standard channel per scope.
  - `UX_chat_channel_name` keeps live names unique, ignoring case.
  - `TR_chat_channel_limit` keeps the ceiling.
  - The Fleet and Armada keys are composite with the Community, and a channel goes with its scope.
- **`chat_direct_conversation`**: one row per pair, lower ID first (`UQ_…_pair`, `CHK_…_order`),
  gone with either account. `AddChatNotices1796100000000` adds `lowNoticedAt` and
  `highNoticedAt`, and chat's three kinds to `notification_outbox_kind_enum`; reverting it drops
  the columns, deletes any chat notice still waiting, and makes the type again without them.
- **`chat_message`**:
  - `UQ_chat_message_client` makes one message per author and client ID.
  - `CHK_chat_message_place` puts it in exactly one channel or conversation.
  - `CHK_chat_message_body` refuses a blank body.
  - `mentions` (user IDs) and `replyToMessageId` are FC-033's.
  - Messages are read by place and instant, and purged by instant. An author's account going sets
    them to nobody.
- **`chat_action`**: write-once (`TR_chat_action_guard`), except that the actor and the message may
  be cleared when they go.

`AddChatTranscriptsAndReports1796200000000` (FC-035) adds `TRANSCRIPT_REQUESTED` and
`TRANSCRIPT_DOWNLOADED` to `chat_action_kind_enum`, the type `chat_transcript_status_enum`, and
three tables:

- **`chat_transcript`**:
  - `CHK_chat_transcript_range`: from before to, to no later than the request, and from no more
    than seven days before it.
  - `CHK_chat_transcript_purpose`: 10 to 500 characters, trimmed.
  - It goes with its channel. The requester's account going sets it to nobody, and the sweep then
    fails anything of theirs still waiting.
- **`chat_message_report`**: the member reports' `report_reason_enum` and `report_status_enum`.
  - `UQ_chat_message_report_once`: one report a person a message.
  - `CHK_chat_message_report_place`: exactly one channel or conversation.
  - No key to `chat_message`, so the purge never touches it.
- **`chat_report_evidence`**: positions 0 to 20, unique per report, gone with its report, and
  likewise no key to `chat_message`.

Reverting drops the three tables and the status type, deletes the transcript log entries, and makes
the log's type again without them.

Rehearsed against the local database:

- Six creations at once in one scope: three were accepted and three refused.
- Unarchiving a fourth channel was refused (23514).
- These were refused as unique clashes (23505): a second standard channel, a clashing name, and a
  reused client ID.
- These were refused as CHECK failures (23514): posting looser than reading, a standard channel
  with a role, a blank name, both a Fleet and an Armada, a blank message, both places or neither,
  a conversation out of order, and rewriting a logged action.
- A message over 2,000 characters was refused as too long (22001).
- Clearing a logged action's actor was allowed.
