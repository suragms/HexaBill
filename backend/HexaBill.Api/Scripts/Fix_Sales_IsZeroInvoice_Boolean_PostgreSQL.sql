-- Sales.IsZeroInvoice was created as integer (0/1); model expects bool. Fixes "Reading as System.Boolean is not supported for fields having DataTypeName integer".
-- Run once via RunSql (DATABASE_URL_EXTERNAL from .env).

ALTER TABLE "Sales" ALTER COLUMN "IsZeroInvoice" DROP DEFAULT;
ALTER TABLE "Sales" ALTER COLUMN "IsZeroInvoice" TYPE boolean USING (COALESCE("IsZeroInvoice"::int, 0) != 0);
ALTER TABLE "Sales" ALTER COLUMN "IsZeroInvoice" SET DEFAULT false;
