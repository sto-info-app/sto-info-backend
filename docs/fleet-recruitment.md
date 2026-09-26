# Fleet recruitment

How people come into a Fleet and leave it: recruitment states, applications, invitations and the
membership they grant (FC-021).

See also [Roster history](roster-history.md), whose evidence a decider is shown, and
[Fleet reports](fleet-reports.md).

## Three ways in, one record

Steve decided on 26 September 2026 what each recruitment state lets an outsider do:

| State | Outsiders | Officers |
| --- | --- | --- |
| `OPEN` | **Join** with one of their Characters; membership is granted at once | May invite |
| `APPLICATION` | **Apply** with a Character and the Fleet's form; a decider answers | May invite |
| `INVITE_ONLY` | Nothing | May invite |
| `CLOSED` | Nothing | May invite |

An invitation works in every state, because it is the Fleet reaching out on purpose.

Every way in leaves one `fleet_application` row, told apart by `route` (`APPLICATION`,
`OPEN_JOIN`, `INVITATION`). A join and an accepted invitation are accepted as they are made, so
every membership recruitment grants has one record of how it came about.

Applications go to Fleets only. A Community's recruitment state is shown in the directory and
pre-fills new Fleets, but nobody applies to a Community itself.

## What a way in checks

- **The Character is the person's own**, proved over a lock, and plays on the Fleet's platform.
  That is the story's second criterion.
- **The Fleet's requirements** apply to joining and applying: a minimum level, allowed factions,
  and a paragraph in the Fleet's own words. An invitation bypasses them, since an officer chose
  the invitee.
- **One pending application per Character per Fleet**, by a partial unique index. A person may
  apply to several Fleets at once, and may apply again as soon as an application is decided or
  withdrawn.
- **Nobody joins twice.** A member, or somebody whose membership is suspended, is refused; so is
  the Community's Owner, who has the Fleet's access already.
- **Nobody decides their own application.**

## The form

`fleet_recruitment_settings` holds one write-once version per change to a Fleet's state,
requirements or questions. An application keeps the version it answered, and one sent against a
version older than the current one is refused so the applicant answers the form that is really
there. That is the story's first criterion: a form change never rewrites an answer, and the
database refuses to.

`sto_fleet.recruitmentState` stays the current state for the directory and changes with each
version, in the same transaction. After registration this is the only way it changes: the Fleet
edit route no longer accepts it.

A form holds up to 20 questions of four kinds:

| Kind | Answer |
| --- | --- |
| `SHORT_TEXT` | One line, up to 200 characters |
| `LONG_TEXT` | A paragraph, up to 2,000 characters, plain text |
| `SINGLE_CHOICE` | One of two to ten options |
| `YES_NO` | A boolean, such as agreeing to the Fleet's rules |

A question keeps its identifier across versions that keep it, so an answer names the question it
answered.

## Deciding

A decider holding `applications.decide` accepts or rejects. **A rejection needs a reason, and the
applicant is shown it**; an acceptance may carry a note, also shown. The application is locked
and a decision made against an older revision is refused, so two deciders at once cannot both
succeed. Every step — submitted, withdrawn, accepted, rejected — is logged in
`fleet_application_action` with who and when.

Beside each application, the decider sees **what the roster says about the Character**: whether
the Fleet's latest in-force export lists it by its exact name and handle, since when it has been
listed continuously, and at what rank. It is matched as FC-018's proposals and FC-020's profile
links match, and read from the published revision. **Nothing reads it to approve anything**,
which is the story's third criterion.

A decision reaches the applicant as a status on their own applications page, not as a
notification. FC-029 adds feed entries later.

## Acceptance

Acceptance grants **Fleet membership** as a `MEMBER` at once, and advances the Fleet's
authorisation revision in the same transaction.

It does **not** move the applicant's Character into the Fleet. STO Info cannot invite anybody in
game, so the applicant is asked instead, by a proposal carrying the application's ID, to confirm
the Fleet once the in-game invitation has happened. Confirming it records the Character's
membership with the source `APPLICATION`.

## Leaving and removal

A member may leave (`LEFT`). A holder of `members.manage` may remove a member (`REVOKED`), with a
reason; somebody holding a role at the Fleet is not removed until the role goes. Both drop any
role held at the Fleet and advance the authorisation revision. Because a membership row is
updated in place, every grant, departure and removal is logged in `scope_membership_action`.

## Invitations

An officer holding `applications.decide` invites a person by their STO Info username. An
invitation lapses **14 days** after it is sent; expiry is a date read when it is needed, and
`LAPSED` is set only when a lapsed invitation is replaced by a new one. At most one invitation
per person per Fleet is open.

## Routes

| Route | Who |
| --- | --- |
| `GET  /fleet-communities/:c/fleets/:f/recruitment` | Anyone who may see the Fleet |
| `PUT  …/recruitment/settings` | `recruitment.manage` |
| `POST …/recruitment/join` | Signed in; the service checks the rest |
| `POST …/recruitment/applications` | Signed in; the service checks the rest |
| `GET  …/recruitment/applications` | `applications.view` |
| `GET  …/recruitment/applications/:id` | `applications.view` |
| `POST …/recruitment/applications/:id/decision` | `applications.decide` |
| `GET  …/recruitment/invitations` | `applications.view` |
| `POST …/recruitment/invitations` | `applications.decide` |
| `POST …/recruitment/invitations/:id/withdraw` | `applications.decide` |
| `GET  …/recruitment/members` | `members.manage` |
| `POST …/recruitment/members/:id/remove` | `members.manage` |
| `POST …/recruitment/leave` | A member |
| `GET  /fleet-recruitment/applications` | The applicant |
| `POST /fleet-recruitment/applications/:id/withdraw` | The applicant |
| `GET  /fleet-recruitment/invitations` | The invitee |
| `POST /fleet-recruitment/invitations/:id/accept` | The invitee |
| `POST /fleet-recruitment/invitations/:id/decline` | The invitee |

Every route is behind the Fleet Community switch.

## Local testing

`1795000000000-SeedLocalFleetApplicant` gives a local database a second person to apply with, when
`NODE_ENV` is `local` and `DATASEED_FLEET_APPLICANT_EMAIL`, `_USERNAME` and `_PASSWORD` are all
set. They get a Windows account and the Character **Dax Orlan@fixture002**, level 65, whom the
Fixture Basic Fleet's roster exports list as a Recruit, so the evidence panel has something to
show.
