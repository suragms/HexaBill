-- Fix RoundOff column type: migration created it as TEXT (SQLite style); PostgreSQL needs numeric for decimal mapping.
-- Run once on Render Postgres (e.g. via RunSql from PC with DATABASE_URL_EXTERNAL from .env).
-- Drop default before type change, then restore.

-- Sales.RoundOff
ALTER TABLE "Sales" ALTER COLUMN "RoundOff" DROP DEFAULT;
ALTER TABLE "Sales" ALTER COLUMN "RoundOff" TYPE numeric USING (COALESCE(NULLIF(trim("RoundOff"::text), '')::numeric, 0));
ALTER TABLE "Sales" ALTER COLUMN "RoundOff" SET DEFAULT 0;

-- HeldInvoices.RoundOff
ALTER TABLE "HeldInvoices" ALTER COLUMN "RoundOff" DROP DEFAULT;
ALTER TABLE "HeldInvoices" ALTER COLUMN "RoundOff" TYPE numeric USING (COALESCE(NULLIF(trim("RoundOff"::text), '')::numeric, 0));
ALTER TABLE "HeldInvoices" ALTER COLUMN "RoundOff" SET DEFAULT 0;
