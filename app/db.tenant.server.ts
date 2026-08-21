/**
 * db.tenant.server.ts
 *
 * A Prisma client that runs queries under Postgres row level security.
 *
 * Tenant isolation in this app is a `shop` filter written by hand on every
 * query. That is correct until the day one query is written without it, and a
 * missing filter fails silently -- it returns more data rather than less. The
 * RLS policies added in prisma/migrations/20260731093000_row_level_security turn
 * that into a database-enforced rule, but only for connections that are not the
 * table owner. This module is the connection that isn't.
 *
 * How it works
 * ------------
 * withShop() opens a transaction on the `app_tenant` connection, sets
 * app.current_shop for the life of that transaction, and hands you a client
 * bound to it. Every policy reads that setting, so a query that forgets its
 * `shop` filter returns zero rows instead of another tenant's.
 *
 * The setting is transaction-local (the `true` argument to set_config), which
 * matters: the connection goes back to a pool afterwards, and a value that
 * outlived the transaction would leak one shop's context into the next
 * request's queries.
 *
 * When it is inert
 * ----------------
 * With TENANT_DATABASE_URL unset, withShop() falls through to the ordinary
 * owner client and behaves exactly as the code did before. That is the default,
 * and it makes adopting this safe to do one call site at a time: nothing
 * changes until the role exists and the variable is set.
 *
 * What must NOT use this
 * ----------------------
 * Anything that legitimately crosses shops, and would break under a policy:
 *   - the Shopify session store (it resolves a session before we know the shop)
 *   - the compliance webhooks
 *   - the background sweeps (retention, cron, reconciliation)
 *   - anything keyed by an API key rather than a shop
 * Those keep using the default export from db.server, which connects as the
 * owner and bypasses RLS. See docs/row-level-security.md.
 */

import { PrismaClient, Prisma } from "@prisma/client";
import prisma from "./db.server";

const tenantUrl = process.env.TENANT_DATABASE_URL;

// A shop domain reaches the database through set_config as a bound parameter,
// so this is not an injection guard -- it is a guard against silently scoping a
// query to a nonsense value, which under RLS means "return nothing" and would
// look like missing data rather than a bug.
const SHOP_RE = /^[a-zA-Z0-9][a-zA-Z0-9.-]{0,127}$/;

declare global {
  // eslint-disable-next-line no-var
  var tenantPrismaGlobal: PrismaClient | undefined;
}

function createTenantClient(): PrismaClient | null {
  if (!tenantUrl) return null;
  return new PrismaClient({ datasources: { db: { url: tenantUrl } } });
}

// Reused across hot reloads in development, same as db.server does.
const tenantClient: PrismaClient | null =
  global.tenantPrismaGlobal ?? createTenantClient();
if (process.env.NODE_ENV !== "production" && tenantClient) {
  global.tenantPrismaGlobal = tenantClient;
}

/** True when queries through withShop() are actually enforced by the database. */
export const rlsEnforced = Boolean(tenantClient);

/**
 * Run `fn` with every query scoped to `shop` by row level security.
 *
 * The client passed to `fn` is a transaction client: use it instead of the
 * module-level prisma import inside the callback, or the queries will run
 * outside the transaction and outside the policy.
 */
export async function withShop<T>(
  shop: string,
  // Prisma.TransactionClient is the library's own type for an interactive
  // transaction client. An earlier version of this spelled it by hand as
  // Omit<PrismaClient, "$connect" | ...>, which looks equivalent but is not:
  // structurally re-deriving the delegates loses the nominal identity of the
  // model types, so a findFirst() through it produced a Campaign-shaped object
  // that would not assign to Campaign.
  fn: (tx: Prisma.TransactionClient) => Promise<T>
): Promise<T> {
  if (!shop || !SHOP_RE.test(shop)) {
    throw new Error(`withShop: refusing to scope to an implausible shop domain`);
  }

  // Not configured yet -- behave exactly as before, on the owner connection.
  if (!tenantClient) {
    return fn(prisma);
  }

  return tenantClient.$transaction(async (tx) => {
    // set_config(..., is_local => true) rather than SET LOCAL, because SET does
    // not accept a bound parameter and we will not interpolate a shop domain
    // into SQL text.
    await tx.$executeRaw`SELECT set_config('app.current_shop', ${shop}, true)`;
    return fn(tx);
  });
}
