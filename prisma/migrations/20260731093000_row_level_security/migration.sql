-- Row Level Security: a second, database-enforced check that a query can only
-- ever touch one shop's rows.
--
-- Until now tenant isolation lived entirely in application code, as a `shop`
-- filter written by hand on every query. That works right up until one query is
-- written without it, which is precisely the class of bug this migration exists
-- to make impossible.
--
-- READ THIS BEFORE DEPLOYING
--
-- This migration is deliberately inert for the running application. It enables
-- RLS and defines the policies, but does NOT use FORCE ROW LEVEL SECURITY, so
-- the table owner -- the role the app connects as today via DATABASE_URL --
-- continues to bypass every policy exactly as before. Deploying this changes no
-- behaviour and cannot cause an outage.
--
-- The policies only start applying when a query arrives on a connection using a
-- non-owner role. That is what app/db.tenant.server -> withShop() is for: it
-- connects as `app_tenant` via TENANT_DATABASE_URL and sets app.current_shop for
-- the duration of a transaction.
--
-- TENANT_DATABASE_URL is IN ADDITION TO DATABASE_URL, never a replacement for
-- it. DATABASE_URL must keep pointing at the owner role: migrations, the
-- Shopify session store, the background sweeps and the compliance webhooks all
-- legitimately work across shops and must keep bypassing these policies.
--
-- See docs/row-level-security.md for the one-time role setup.


-- Session
ALTER TABLE "Session" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON "Session";
CREATE POLICY "tenant_isolation" ON "Session"
  USING ("shop" = current_setting('app.current_shop', true))
  WITH CHECK ("shop" = current_setting('app.current_shop', true));

-- SizeChart
ALTER TABLE "SizeChart" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON "SizeChart";
CREATE POLICY "tenant_isolation" ON "SizeChart"
  USING ("shop" = current_setting('app.current_shop', true))
  WITH CHECK ("shop" = current_setting('app.current_shop', true));

-- ProductMapping
ALTER TABLE "ProductMapping" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON "ProductMapping";
CREATE POLICY "tenant_isolation" ON "ProductMapping"
  USING ("shop" = current_setting('app.current_shop', true))
  WITH CHECK ("shop" = current_setting('app.current_shop', true));

-- FallbackMapping
ALTER TABLE "FallbackMapping" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON "FallbackMapping";
CREATE POLICY "tenant_isolation" ON "FallbackMapping"
  USING ("shop" = current_setting('app.current_shop', true))
  WITH CHECK ("shop" = current_setting('app.current_shop', true));

-- GlobalSettings
ALTER TABLE "GlobalSettings" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON "GlobalSettings";
CREATE POLICY "tenant_isolation" ON "GlobalSettings"
  USING ("shop" = current_setting('app.current_shop', true))
  WITH CHECK ("shop" = current_setting('app.current_shop', true));

-- SizeChartColumn (no shop column of its own -- derived through SizeChart)
ALTER TABLE "SizeChartColumn" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON "SizeChartColumn";
CREATE POLICY "tenant_isolation" ON "SizeChartColumn"
  USING (EXISTS (SELECT 1 FROM "SizeChart" p WHERE p."id" = "SizeChartColumn"."chartId" AND p."shop" = current_setting('app.current_shop', true)))
  WITH CHECK (EXISTS (SELECT 1 FROM "SizeChart" p WHERE p."id" = "SizeChartColumn"."chartId" AND p."shop" = current_setting('app.current_shop', true)));

-- SizeChartRow (no shop column of its own -- derived through SizeChart)
ALTER TABLE "SizeChartRow" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON "SizeChartRow";
CREATE POLICY "tenant_isolation" ON "SizeChartRow"
  USING (EXISTS (SELECT 1 FROM "SizeChart" p WHERE p."id" = "SizeChartRow"."chartId" AND p."shop" = current_setting('app.current_shop', true)))
  WITH CHECK (EXISTS (SELECT 1 FROM "SizeChart" p WHERE p."id" = "SizeChartRow"."chartId" AND p."shop" = current_setting('app.current_shop', true)));

-- SizeChartImage (no shop column of its own -- derived through SizeChart)
ALTER TABLE "SizeChartImage" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON "SizeChartImage";
CREATE POLICY "tenant_isolation" ON "SizeChartImage"
  USING (EXISTS (SELECT 1 FROM "SizeChart" p WHERE p."id" = "SizeChartImage"."chartId" AND p."shop" = current_setting('app.current_shop', true)))
  WITH CHECK (EXISTS (SELECT 1 FROM "SizeChart" p WHERE p."id" = "SizeChartImage"."chartId" AND p."shop" = current_setting('app.current_shop', true)));

-- SizeChartTranslation (no shop column of its own -- derived through SizeChart)
ALTER TABLE "SizeChartTranslation" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON "SizeChartTranslation";
CREATE POLICY "tenant_isolation" ON "SizeChartTranslation"
  USING (EXISTS (SELECT 1 FROM "SizeChart" p WHERE p."id" = "SizeChartTranslation"."chartId" AND p."shop" = current_setting('app.current_shop', true)))
  WITH CHECK (EXISTS (SELECT 1 FROM "SizeChart" p WHERE p."id" = "SizeChartTranslation"."chartId" AND p."shop" = current_setting('app.current_shop', true)));

-- SizeChartCell (no shop column of its own -- derived through SizeChartRow -> SizeChart)
ALTER TABLE "SizeChartCell" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON "SizeChartCell";
CREATE POLICY "tenant_isolation" ON "SizeChartCell"
  USING (EXISTS (SELECT 1 FROM "SizeChartRow" r JOIN "SizeChart" c ON c."id" = r."chartId" WHERE r."id" = "SizeChartCell"."rowId" AND c."shop" = current_setting('app.current_shop', true)))
  WITH CHECK (EXISTS (SELECT 1 FROM "SizeChartRow" r JOIN "SizeChart" c ON c."id" = r."chartId" WHERE r."id" = "SizeChartCell"."rowId" AND c."shop" = current_setting('app.current_shop', true)));


-- Grants for the tenant role, applied only if it already exists so this
-- migration stays runnable on a database where the role has not been created
-- yet (see docs/row-level-security.md). Re-running is harmless.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_tenant') THEN
    GRANT USAGE ON SCHEMA public TO app_tenant;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_tenant;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_tenant;
  END IF;
END $$;
