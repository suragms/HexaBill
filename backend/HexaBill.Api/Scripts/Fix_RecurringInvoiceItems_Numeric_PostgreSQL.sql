-- RecurringInvoiceItems.Qty and UnitPrice were created as TEXT; model expects decimal. Fixes "exception while iterating over the results".
-- Run once via RunSql (DATABASE_URL_EXTERNAL from .env).

ALTER TABLE "RecurringInvoiceItems" ALTER COLUMN "Qty" TYPE numeric USING (COALESCE(NULLIF(trim("Qty"), '')::numeric, 0));
ALTER TABLE "RecurringInvoiceItems" ALTER COLUMN "UnitPrice" TYPE numeric USING (COALESCE(NULLIF(trim("UnitPrice"), '')::numeric, 0));
