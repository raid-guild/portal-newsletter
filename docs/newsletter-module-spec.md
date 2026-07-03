# Portal Newsletter Module Spec

## Status

Planned. This repo will support a Portal newsletter module backed by listmonk
for campaign delivery and SendGrid for email transport.

## Product Intent

The newsletter module should let trusted Portal editors create, review, and send
source-grounded newsletter issues to opted-in audiences without turning the
Portal app into a full email service provider.

The module should answer:

- What newsletter issue is being drafted or scheduled?
- Which Portal posts or source records are included?
- Which audience sources are eligible?
- Who approved the send?
- Which external campaign was created?
- Were sends, unsubscribes, bounces, or errors observed?

## Non-Goals

- Do not make Payload the bulk email campaign engine.
- Do not share Portal database tables with listmonk.
- Do not silently email scraped, stale, or unverified addresses.
- Do not infer membership from imported email-only lists.
- Do not bypass SendGrid/listmonk unsubscribe and suppression behavior.
- Do not let agents or editors publish broad sends without review.

## System Boundary

Portal owns:

- user accounts, roles, and access control
- newsletter issue drafts and approvals
- relationships to Portal posts, briefs, events, projects, and activity
- audience source policy and provenance
- listmonk API calls
- audit records for sync and campaign creation

listmonk owns:

- subscribers
- lists and segments
- campaign templates
- campaign send state
- unsubscribe pages
- bounce processing
- campaign analytics

SendGrid owns:

- SMTP transport
- domain authentication
- provider-level delivery events
- provider-level reputation and deliverability controls

## Deployment Model

Recommended Railway layout:

```txt
Portal service
Portal Postgres database

listmonk service
listmonk Postgres database

optional newsletter sync or gateway service
```

The listmonk database may live in the same Railway project as Portal, but it
should use its own database/schema and credentials. Portal should integrate with
listmonk through the listmonk API, not direct database writes.

## Module Access

The Portal should remain the source of truth for access control.

Initial approach:

1. Editors manage newsletter issues in Portal.
2. Portal calls listmonk API server-side.
3. Most editors do not need direct listmonk admin access.
4. Admin fallback can link to listmonk with listmonk-native credentials.

Future approach:

- Add a small gateway that accepts the Portal signed module launch token,
  verifies claims, and creates a short-lived local admin session for listmonk
  operations that cannot be comfortably wrapped in Portal.

## Portal Collection Sketch

Collection slug:

```txt
newsletterIssues
```

Recommended fields:

```txt
title: text, required
slug: text, unique, required
subject: text, required
previewText: text
summary: textarea
body: richText
sourcePosts: relationship -> posts, many
sourceBriefs: relationship -> dailyBriefs, many
sourceEvents: relationship -> events, many
sourceProjects: relationship -> projects, many
status: draft / review / approved / scheduled / sent / cancelled
audienceLists: array
listmonkCampaignID: text
testRecipientEmails: array email
testSentAt: date
scheduledAt: date
sentAt: date
approvedBy: relationship -> users
approvedAt: date
sendNotes: textarea
```

## Audience Sources

Recommended listmonk lists:

```txt
Portal users
Portal inquiries
External import: <source name>
Newsletter master
```

Subscriber attributes should preserve provenance:

```json
{
  "source": "portal_user",
  "portalUserID": "123",
  "sourceRecordID": "123",
  "consentStatus": "explicit",
  "syncedAt": "2026-07-03T00:00:00.000Z"
}
```

Audience rules:

- Portal users should only sync when they have a verified email and newsletter
  consent or another clearly documented eligibility basis.
- Inquiry emails should not be treated as newsletter subscribers unless the
  inquiry flow collected newsletter consent.
- External imports must include source name, import date, and consent status.
- Unsubscribed or blocklisted recipients should stay suppressed in listmonk.

## SendGrid Transport

Use SendGrid SMTP from listmonk unless there is a concrete reason to use a
custom SendGrid API messenger.

Recommended SMTP settings:

```txt
host: smtp.sendgrid.net
port: 587
username: apikey
password: SENDGRID_API_KEY
```

The sending domain and from address must be authenticated in SendGrid before
production sends.

## Initial Workflow

1. Editor creates a newsletter issue in Portal.
2. Editor links source posts and writes body copy.
3. Editor chooses audience sources.
4. Portal syncs eligible subscribers to listmonk.
5. Portal creates or updates a listmonk campaign.
6. Editor sends a test.
7. Human approver marks the issue approved.
8. Portal schedules or starts the listmonk campaign.
9. Portal records campaign identifiers and send timestamps.
10. Optional sync jobs pull campaign stats, unsubscribes, and bounce summaries
    back into Portal-visible audit fields.

## Verification Requirements

Before production use:

- Verify listmonk can send through SendGrid SMTP.
- Verify unsubscribe links work.
- Verify bounces are processed or visible.
- Verify Portal cannot sync non-consented inquiry emails by default.
- Verify only approved editor/admin roles can send.
- Run a test campaign to internal recipients.
- Document rollback and suppression procedures.

## Open Questions

- Which Portal preference field should represent newsletter consent?
- Should newsletter issues be a Portal collection or a lightweight service in
  this repo?
- Should external imports happen through listmonk UI first, Portal UI later, or
  a controlled CSV sync script?
- Which SendGrid domain/subuser should isolate Portal newsletter reputation from
  transactional Portal email?
