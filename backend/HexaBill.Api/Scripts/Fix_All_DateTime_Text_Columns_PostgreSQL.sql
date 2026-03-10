-- Fix remaining datetime columns stored as TEXT (causes NpgsqlDataReader GetInfo/date_trunc errors).
-- Run once on Render Postgres via RunSql (DATABASE_URL_EXTERNAL from .env).
-- Idempotent: safe to run if column is already timestamp (use USING with cast).

-- PaymentReceipts (model: DateTime)
ALTER TABLE "PaymentReceipts" ALTER COLUMN "GeneratedAt" TYPE timestamp with time zone USING "GeneratedAt"::timestamp with time zone;

-- RecurringInvoices (model: DateTime)
ALTER TABLE "RecurringInvoices" ALTER COLUMN "StartDate" TYPE timestamp with time zone USING "StartDate"::timestamp with time zone;
ALTER TABLE "RecurringInvoices" ALTER COLUMN "EndDate" TYPE timestamp with time zone USING (NULLIF(trim("EndDate"), '')::timestamp with time zone);
ALTER TABLE "RecurringInvoices" ALTER COLUMN "NextRunDate" TYPE timestamp with time zone USING "NextRunDate"::timestamp with time zone;
ALTER TABLE "RecurringInvoices" ALTER COLUMN "LastRunDate" TYPE timestamp with time zone USING (NULLIF(trim("LastRunDate"), '')::timestamp with time zone);
ALTER TABLE "RecurringInvoices" ALTER COLUMN "CreatedAt" TYPE timestamp with time zone USING "CreatedAt"::timestamp with time zone;
ALTER TABLE "RecurringInvoices" ALTER COLUMN "UpdatedAt" TYPE timestamp with time zone USING "UpdatedAt"::timestamp with time zone;
