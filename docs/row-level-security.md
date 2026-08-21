# Row Level Security

Tenant isolation in this app has always been a `shop` filter written by hand on
every query. That is correct right up until one query is written without it —
and a missing filter fails in the dangerous direction: it returns more rows, not
fewer, so nothing breaks and nobody notices.

Row Level Security moves that rule into the database, where it cannot be
forgotten. It does not replace the `shop` filters; it is the net under them.

## What is already in place

`prisma/migrations/20260731093000_row_level_security` enables RLS on every table
and defines a `tenant_isolation` policy on each one. Tables that carry a `shop`
column are matched directly; tables that do not (chart columns, rows, cells,
images, 360 frames) are matched by walking up to the parent that does.

Every policy compares against `current_setting('app.current_shop', true)`. When
that setting is absent the comparison is NULL, which is not true, so the policy
matches nothing. It fails closed.

**The migration is inert for the running app.** It deliberately does not use
`FORCE ROW LEVEL SECURITY`, so the table owner — the role the app connects as
today through `DATABASE_URL` — keeps bypassing every policy, exactly as before.
Deploying the migration on its own changes no behaviour and cannot cause an
outage. The policies only begin to apply to connections made as a *different*
role, which is what the setup below creates.

## One-time setup per database

Run this once against each app's database, as a role that can create roles
(on Railway that is the default `postgres` user). Pick a real password.

```sql
-- 1. The role the application will use for tenant-scoped queries.
CREATE ROLE app_tenant LOGIN PASSWORD 'CHANGE-ME';

-- 2. It must NOT own the tables and must NOT have BYPASSRLS, or the policies
--    do nothing. Both are the default; this is here so it gets checked.
ALTER ROLE app_tenant NOBYPASSRLS;

-- 3. Access to the schema and the tables that exist today.
GRANT USAGE ON SCHEMA public TO app_tenant;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_tenant;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_tenant;

-- 4. And to tables added by future migrations. Without this, every new table is
--    invisible to app_tenant until someone remembers to grant it by hand.
--    Run as the role that owns the tables (the one migrations run as).
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_tenant;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO app_tenant;
```

Then set, alongside the existing `DATABASE_URL`:

```
TENANT_DATABASE_URL=postgresql://app_tenant:CHANGE-ME@HOST:PORT/DATABASE
```

`TENANT_DATABASE_URL` is **in addition to** `DATABASE_URL`, never a replacement.
`DATABASE_URL` must keep pointing at the owner role — see below for why.

## Using it

`app/db.tenant.server` exports `withShop()`:

```ts
import { withShop } from "../db.tenant.server";

const { session } = await authenticate.admin(request);

const campaigns = await withShop(session.shop, (tx) =>
  tx.campaign.findMany({ where: { shop: session.shop } })
);
```

Two things to hold on to:

- Use the `tx` client inside the callback, not the module-level `prisma` import.
  A query on the outer client runs on a different connection, outside the
  transaction, and therefore outside the policy — it will quietly keep working
  with no isolation.
- Keep the `where: { shop }` filter. RLS is the backstop, not the mechanism.
  Removing the filters would leave correctness resting on a single layer again,
  just a different one, and would make every query pay for a policy check it
  could have avoided with an index.

## What must keep bypassing RLS

Some work legitimately spans shops and will return nothing — or fail — under a
policy. All of it uses the plain owner client from `db.server`, and must
continue to:

| Path | Why |
| --- | --- |
| Shopify session storage (`PrismaSessionStorage`) | resolves a session *before* the shop is known; scoping it is circular |
| Compliance webhooks (`shop/redact`, `customers/redact`) | run after uninstall, outside any admin session |
| Background sweeps (`cron.server`, `retention.server`) | operate across every shop by design |
| `api/analytics` (preorder) | authenticated by API key, which resolves to a shop only after a lookup |
| `copy-to-shops` (360) | deliberately writes into other shops, now bounded by an allowlist |
| Prisma migrations | must be able to alter every table |

This split is the reason `DATABASE_URL` stays on the owner role.

## Verifying it actually works

After setting `TENANT_DATABASE_URL`, confirm the policies bite. Connect as
`app_tenant`:

```sql
-- No context set: every table should come back empty.
SELECT count(*) FROM "Session";

-- With context set, only that shop's rows.
SELECT set_config('app.current_shop', 'your-store.myshopify.com', false);
SELECT count(*) FROM "Session";
```

If the first query returns a non-zero count, the role is bypassing RLS —
check that it does not own the tables and does not have `BYPASSRLS`.
