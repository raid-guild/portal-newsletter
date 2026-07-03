# Portal Newsletter

Operational home for the RaidGuild Portal newsletter module.

This repo is intended to hold deployment notes, listmonk configuration, and any
small integration services needed to connect the Portal to listmonk. The Portal
application remains the source of truth for users, roles, content, permissions,
and editorial approval.

## Initial Architecture

```txt
Portal
  -> newsletter issues, permissions, approval, source records
  -> listmonk API

listmonk
  -> subscriber lists, campaigns, templates, unsubscribes, bounces
  -> SendGrid SMTP

SendGrid
  -> delivery provider
```

See [docs/newsletter-module-spec.md](docs/newsletter-module-spec.md).

## Deployment

The first deployment target is the existing RaidGuild Railway project used by
Portal services. See [docs/railway-deployment.md](docs/railway-deployment.md).
