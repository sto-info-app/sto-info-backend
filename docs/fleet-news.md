# Fleet news

A Community's, a Fleet's and an Armada's own news (FC-027). The code is in `src/fleet/news`. The
decisions below are Steve's, from 28 September 2026.

There is one news system. A scoped post is a row of the site's own `news_post` table that names
its scope; the site's news is unchanged, and every query for it asks for `communityId IS NULL`
explicitly — the public list, a post by its slug, the category counts, and the administrators'
editor. That is what keeps a scoped post out of the site's `/news` page, its RSS feed, its sitemap
and its Open Graph images, all of which the frontend builds from those routes.

## A scoped post

- **Scope.** It names its Community and, for a Fleet or an Armada, that too — never both. A
  Community's news is its own posts, not its Fleets' or Armadas'.
- **Audience.** One of anyone (`PUBLIC`), the Community's followers and members (`COMMUNITY`), or
  the scope's own members (`FLEET_MEMBERS`: a Fleet's approved members, an Armada's through its
  placed Fleets, or a Community's, which counts the approved members of every Fleet in it —
  FC-050, see [Fleet governance](fleet-governance.md#who-a-communitys-audience-admits)). A
  Community's followers and members include every one of its Fleets' members too, on a Fleet's
  or an Armada's post as on the Community's. `PUBLIC` is the default. `PRIVATE`, the Community's
  Owner alone, is no audience for news.
- **Capped by its scope.** Nobody reads a post of a scope they may not see, asked afresh on every
  read. Narrowing a Fleet's visibility narrows its posts without anything being rewritten.
- **The audience may change** after publication, either way. It takes effect at the next read.
- **No category.** Categories are the site's.
- **A cover.** One optional picture, 16:9, sent through the scan ingress like any other upload
  and published to Cloudflare Images when cleared, as a Fleet's banner is. What gates it is that
  only the post's audience is handed the post naming it. Its link, once somebody has it, is not
  revoked by narrowing the post; FC-040 revisits gated delivery.
- **Its address** is made from its title when it is written, with the same time-based suffix the
  site's news uses, and never changes afterwards, so a link keeps working when the title is edited.
- **Its author** is shown by username to everybody who may read it. The name links to their
  profile only where the registry would show it to the reader: public, active, and no block
  either way.

## Who may do what

| Who | May |
| --- | --- |
| Anybody who may see the scope | Read its published posts in their audience, and search them by title and summary |
| `news.write` at the scope | Also read its drafts and every audience; write, edit, publish, unpublish and delete any post there, and set or remove its cover |
| A site administrator | Unpublish or delete any scoped post, whatever the scope's state |

`news.write` is held by the Owner and Admins by default, and can be delegated to Officers or to
one person. A Community role reaches every Fleet and Armada in it, so a Community's Owner and
Admins write their Fleets' and Armadas' news too. A site administrator writes a scoped post only
by holding `news.write` there like anybody else.

**A closed or suspended scope** keeps its published posts readable to their audience, and nothing
there may be written, edited, published or unpublished (409). Its drafts may still be deleted.

Every change is saved through the repository, so the audit log records it and who made it.

## Routes

`:scope` is `fleet-communities/:c`, `fleet-communities/:c/fleets/:f` or
`fleet-communities/:c/armadas/:a`.

| Route | Who |
| --- | --- |
| `GET /:scope/news?page=&pageSize=&q=&status=` | Anybody who may see the scope; drafts (`status=DRAFT`) need `news.write`. 10 a page by default, at most 50 |
| `GET /:scope/news/:slug` | Anybody the post is published to; a draft needs `news.write` |
| `POST /:scope/news` | `news.write`; writes a draft |
| `PATCH /:scope/news/:postId` | `news.write` |
| `POST /:scope/news/:postId/publish` | `news.write` |
| `POST /:scope/news/:postId/unpublish` | `news.write` |
| `DELETE /:scope/news/:postId` | `news.write` |
| `POST /:scope/news/:postId/cover-image` | `news.write`; multipart, with `altText` |
| `DELETE /:scope/news/:postId/cover-image` | `news.write` |
| `POST /admin/fleet-news/:postId/unpublish` | Site administrators |
| `DELETE /admin/fleet-news/:postId` | Site administrators |

A post or scope the caller may not see answers 404, the same as one that does not exist. The list
leaves out each post's body, and answers with `mayWrite`, `isOpen` and `isSuspended` so the page
knows what to offer, and says a suspended scope's news waits on its reinstatement rather than that
it is closed (FC-050); so does a single post. Every route is behind the Fleet Community switch.

## The schema

`ScopeNewsPosts1795600000000` adds `communityId`, `fleetId`, `armadaId`, `audience`,
`coverImageId` and `coverImageAlt` to `news_post`, and lets `category` be empty.

- `CHK_news_post_scope` holds both shapes: the site's posts name no scope, have a category and no
  audience or cover; a scoped post names its Community, at most one of a Fleet and an Armada, an
  audience other than `PRIVATE`, and no category. Each branch tests every nullable column it
  relies on, so the check never passes by evaluating to NULL.
- The Fleet and Armada keys are composite with the Community, so a post cannot name another
  Community's Fleet.
- `UX_news_post_slug` is now unique among the site's posts only, and `UX_news_post_scope_slug`
  within each scope. The latter reads the Fleet and Armada through `COALESCE`, so two of a
  Community's own posts collide rather than passing each other as NULLs.
- The migration was applied, reverted and applied again locally, and 17 statements aimed at the
  constraints were each refused or allowed as intended.

Reverting deletes every scoped post, since the site's news had nowhere to hold them.
