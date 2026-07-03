# Railway Deployment

## Project

Use the existing Railway project:

```txt
project: cc5cc412-f183-4fcc-a88d-5141dc8b8fa7
environment: b61b88e7-e8a1-40b6-b52f-bc8187032956
```

The local repo has been linked with:

```bash
railway link \
  --project cc5cc412-f183-4fcc-a88d-5141dc8b8fa7 \
  --environment b61b88e7-e8a1-40b6-b52f-bc8187032956
```

## Recommended Services

Create two Railway services:

```txt
portal-newsletter-listmonk
portal-newsletter-db
```

The database should be separate from the Portal CMS database. It can live in the
same Railway project, but listmonk should use its own database service or at
least its own database/schema and credentials.

## App Deployment

This repo deploys listmonk from the official Docker image pinned in the
`Dockerfile`.

The container command:

1. maps Railway `PG*` variables to listmonk `LISTMONK_db__*` variables when
   direct listmonk variables are not set
2. runs `listmonk --install --idempotent --yes`
3. runs `listmonk --upgrade --yes`
4. starts listmonk

## Required Variables

Set either Railway `PG*` variables:

```txt
PGHOST
PGPORT
PGUSER
PGPASSWORD
PGDATABASE
```

Recommended Railway reference variables for a database service named
`portal-newsletter-db`:

```txt
PGHOST=${{portal-newsletter-db.PGHOST}}
PGPORT=${{portal-newsletter-db.PGPORT}}
PGUSER=${{portal-newsletter-db.PGUSER}}
PGPASSWORD=${{portal-newsletter-db.PGPASSWORD}}
PGDATABASE=${{portal-newsletter-db.PGDATABASE}}
```

Current production service names:

```txt
listmonk app: portal-newsletter-listmonk
listmonk database: Postgres-yasV
public URL: https://portal-newsletter-listmonk-production.up.railway.app
```

Current production variable references:

```txt
PGHOST=${{Postgres-yasV.PGHOST}}
PGPORT=${{Postgres-yasV.PGPORT}}
PGUSER=${{Postgres-yasV.PGUSER}}
PGPASSWORD=${{Postgres-yasV.PGPASSWORD}}
PGDATABASE=${{Postgres-yasV.PGDATABASE}}
LISTMONK_db__ssl_mode=require
```

or direct listmonk variables:

```txt
LISTMONK_db__host
LISTMONK_db__port
LISTMONK_db__user
LISTMONK_db__password
LISTMONK_db__database
LISTMONK_db__ssl_mode=require
```

For first boot, optionally set:

```txt
LISTMONK_ADMIN_USER
LISTMONK_ADMIN_PASSWORD
```

If those are not set, listmonk will let the first admin user be created from the
web UI.

## SendGrid SMTP

Configure SMTP inside the listmonk admin UI:

```txt
host: smtp.sendgrid.net
port: 587
username: apikey
password: <SendGrid API key>
```

The SendGrid API key should have mail-send permissions. The from address should
be on an authenticated sending domain.

## First Admin Login

The first successful deployment did not bootstrap a super admin user. Open the
public URL and create the first admin from the listmonk web UI:

```txt
https://portal-newsletter-listmonk-production.up.railway.app/admin
```

After logging in, update listmonk's public/root URL setting from the default
`http://localhost:9000` to:

```txt
https://portal-newsletter-listmonk-production.up.railway.app
```

This keeps subscription links, archive links, and email links from pointing at
localhost.

## API Smoke Test

After SMTP works from the listmonk UI, create an API user/token in listmonk and
run a transactional smoke test from this repo:

```bash
LISTMONK_API_USER='<api user>' \
LISTMONK_API_TOKEN='<api token>' \
TEST_EMAIL='dekanbrown@odyssy.io' \
./scripts/send-tx-test.sh
```

The script:

1. creates a temporary transactional template
2. sends one external-mode transactional email through `/api/tx`
3. deletes the temporary template by default

Set `DELETE_TEMPLATE=false` to keep the temporary template for inspection.

This does not create a subscriber or add the recipient to any list.

## Uploads

Railway service filesystems are ephemeral. If newsletter media uploads are used
inside listmonk, add a Railway volume mounted at:

```txt
/listmonk/uploads
```

If Portal is the editorial source for newsletter media, prefer rendering images
from Portal media URLs instead of uploading duplicate media into listmonk.

## Deployment Commands

After the GitHub repo is connected to a Railway service, deployments should run
from GitHub.

For a manual CLI deployment from this directory:

```bash
railway service link portal-newsletter-listmonk
railway up
```

Use the Railway dashboard to attach the Postgres variables before the first
successful app boot.
