# Custom Tracking — draft Terms of Use and Privacy Policy changes

**Status: draft. Nothing here has been published.**

Custom Tracking introduces the first place on the site where a member defines
their own fields and writes free text, uploads pictures and chooses videos
against them, and the first place where that material can be made public on
their account and captain pages. Both published policies need to say so before
the feature is switched on.

These are drafts rather than edits to the live pages on purpose. Publishing
them changes what members are legally told, moves the "Last updated" date on
both pages, and is the site owner's decision rather than an implementation
detail. The wording below is ready to paste; the decision to paste it is not
being made here.

The pages live in the frontend repository:

- `src/app/static-pages/terms-of-use/terms-of-use.component.html`
- `src/app/static-pages/privacy-policy/privacy-policy.component.html`

The in-app content agreement is separate from both and is already written: it
lives in `src/custom-tracking/constants/custom-tracking-agreement.constants.ts`
and is version `1.0`. A member must accept it before creating anything. It
repeats the prohibitions below in the moment they matter, but it does not
replace the published policies — it is shown once and the policies are the
standing statement.

## What has to be said, and why

| Point                                                     | Where it belongs   |
| --------------------------------------------------------- | ------------------ |
| Members can define their own fields and record their own values | Privacy §1     |
| That material may be made public, and is then visible to anyone, including search engines | Privacy §1, Terms §2 |
| Personal information about the member or anybody else is prohibited in it | Terms §2, Terms §4 |
| Pictures uploaded to custom fields are covered by the existing upload rules | Terms §2 |
| Deleted definitions and values are kept for 180 days before permanent deletion | Privacy §4 |
| An administrator may hide custom content from public view without deleting it | Terms §2, Terms §5 |

The one point that is genuinely new rather than an extension of what the pages
already say is the prohibition on personal information. Everywhere else on the
site, what a member types goes into a field we designed for a known purpose. In
Custom Tracking they design the field, and the honest position — the one the
in-app agreement already takes — is that we cannot prevent them putting
anything in it, so we prohibit it and enforce it after the fact.

## Terms of Use

### Section 2, User Content — add to the existing list

```html
<li>
  Custom Tracking lets you define your own sections, tabs and fields and record
  your own values against your STO accounts and characters. Everything you
  define and record there is your content, and everything in this section
  applies to it.
</li>
<li>
  You must not record personal information in custom tracking &mdash; whether
  your own or anybody else's. That includes real names, addresses, telephone
  numbers, email addresses, account credentials and anything else that
  identifies a living person. Custom fields accept free text and pictures, and
  we cannot stop you entering such information; we can and do prohibit it, and
  we will remove it.
</li>
<li>
  Custom tracking is private until you choose otherwise. If you make a section,
  tab or field public, and your profile, STO account and character are also
  public, what you recorded there can be seen by anyone visiting the site,
  including search engines. Treat anything you make public as published.
</li>
<li>
  Pictures uploaded to a custom field are subject to the same rules as any
  other upload, including the size limit and the prohibitions on adult content,
  copyrighted material and malicious files.
</li>
<li>
  We may hide any custom section, tab or field from public view without
  deleting it. Your data stays yours and you can still see and edit it; the
  rest of the world cannot. Repeated or serious breaches may lead to your
  account being disabled under section 5.
</li>
```

### Section 4, Prohibited Behaviour — add one item

This list uses `no-bullets` with an icon per item, so the new one must match:

```html
<li>
  <i class="fas fa-square-xmark go-red"></i>
  Store or publish personal information about yourself or anybody else in
  custom tracking.
</li>
```

### Section 5, Account Termination — add one sentence

This section is a paragraph rather than a list, so the sentence goes into it:

```html
<p>
  We reserve the right to suspend or terminate your account, with or without
  notice, if you violate these terms, applicable laws, or engage in misconduct.
  Where the problem is confined to particular custom tracking content, we will
  normally hide that content from public view rather than disable your account.
</p>
```

## Privacy Policy

### Section 1, Information We Collect — a new subsection after B, Game Data

```html
<h3>C. Custom Tracking Data</h3>
<ul class="lcars-list">
  <li>
    Sections, tabs and fields you define for yourself, and the values, pictures
    and video links you record against your STO accounts and characters.
  </li>
  <li>
    This information is <strong class="go-gold">private by default</strong>. It
    becomes visible to others only where you have made your profile, the STO
    account, the character (where relevant) and the individual section, tab and
    field public &mdash; all of them. Turning off any one of those hides it
    again immediately.
  </li>
  <li>
    You choose what goes in these fields, so we cannot say in advance what they
    contain. The Terms of Use prohibit recording personal information there,
    about yourself or anybody else, and we ask you not to.
  </li>
  <li>
    Pictures are stored with Cloudflare Images in the same way as the rest of
    the App's uploads. Video fields store only a YouTube video identifier, never
    the address you pasted. The video itself is not loaded until you or a
    visitor presses play, although the still image shown beforehand is served
    by Google, in the same way as elsewhere on the App.
  </li>
</ul>
```

The existing subsections C, D and E become D, E and F. The internal reference
in section 4 to "Audit and login data" is unaffected.

### Section 4, How Long We Keep Your Data — add one item

Suggested placement: after "Closed accounts".

```html
<li>
  <strong class="go-sky">Custom tracking data</strong> - Deleting a section, tab,
  field or value hides it immediately and it can no longer be seen by anyone.
  The underlying records are permanently deleted
  <strong class="go-gold">180 days</strong> later. A deleted option is kept for
  longer where a value you still hold refers to it, because its label is what
  makes that value readable. Pictures are deleted from our image storage as part
  of the same process.
</li>
```

### Section 9, Your Rights — no change needed

Custom Tracking data is covered by the existing account-closure and
data-access statements without amendment: closure cascades to it, and it is
returned by the same processes as everything else the member holds.

## What is deliberately not claimed

- That we prevent personal information being entered. We do not and cannot.
- That public custom content is excluded from search engines. It is not; it is
  published in the ordinary way.
- That deleted data is unrecoverable immediately. It is invisible immediately
  and gone in 180 days, and the pages should say the second thing as well as
  the first.
- That a video field contacts nobody until it is played. The player is not
  loaded until then, but the still image beside it comes from Google's
  thumbnail host as the page loads. An earlier draft of this wording said
  otherwise; the end-to-end journey that checks the player is not loaded is
  what showed it up.

## Before publishing

1. Decide the effective date and update the "Last updated" line on both pages.
2. Check the section numbering after the Privacy Policy insertion — subsections
   C to E shift by one, and the cookie table and rights sections reference none
   of them, but the page's own internal links should be re-read.
3. Consider whether the change warrants notifying existing members. Nothing
   here alters how data already held is treated; it describes a feature that
   does not yet exist for them.
