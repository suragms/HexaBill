-- =============================================================================
-- PASTE THIS ENTIRE FILE INTO RENDER PSQL (Connect → PSQL)
-- Fixes: 42703 column e.TenantId / e0.TenantId, errorMissingColumn (ErrorLogs.ResolvedAt, etc.)
-- Run once, then restart your HexaBill API on Render.
-- =============================================================================

-- ErrorLogs.ResolvedAt (fixes errorMissingColumn for /api/error-logs, alert-summary)
ALTER TABLE "ErrorLogs" ADD COLUMN IF NOT EXISTS "ResolvedAt" timestamp with time zone NULL;
CREATE INDEX IF NOT EXISTS "IX_ErrorLogs_ResolvedAt" ON "ErrorLogs" ("ResolvedAt");

-- 6b. Add TenantId to Expenses
ALTER TABLE "Expenses" ADD COLUMN IF NOT EXISTS "TenantId" integer NULL;
CREATE INDEX IF NOT EXISTS "IX_Expenses_TenantId" ON "Expenses" ("TenantId");
UPDATE "Expenses" SET "TenantId" = "OwnerId" WHERE "TenantId" IS NULL AND "OwnerId" IS NOT NULL;
UPDATE "Expenses" SET "TenantId" = (SELECT "Id" FROM "Tenants" ORDER BY "Id" ASC LIMIT 1) WHERE "TenantId" IS NULL;

-- 7. Add TenantId to ExpenseCategories
ALTER TABLE "ExpenseCategories" ADD COLUMN IF NOT EXISTS "TenantId" integer NULL;
DROP INDEX IF EXISTS "IX_ExpenseCategories_Name";
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='Expenses' AND column_name='TenantId') THEN
    UPDATE "ExpenseCategories" ec
    SET "TenantId" = (
      SELECT e."TenantId" FROM "Expenses" e
      WHERE e."CategoryId" = ec."Id" AND e."TenantId" IS NOT NULL
      LIMIT 1
    )
    WHERE ec."TenantId" IS NULL AND EXISTS (
      SELECT 1 FROM "Expenses" e2 WHERE e2."CategoryId" = ec."Id"
    );
  END IF;
END $$;
UPDATE "ExpenseCategories" ec
SET "TenantId" = (SELECT "Id" FROM "Tenants" ORDER BY "Id" ASC LIMIT 1)
WHERE ec."TenantId" IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "IX_ExpenseCategories_TenantId_Name" ON "ExpenseCategories" ("TenantId", "Name");

-- 8. Add TenantId to InvoiceTemplates
ALTER TABLE "InvoiceTemplates" ADD COLUMN IF NOT EXISTS "TenantId" integer NULL;
CREATE INDEX IF NOT EXISTS "IX_InvoiceTemplates_TenantId" ON "InvoiceTemplates" ("TenantId");
UPDATE "InvoiceTemplates" t
SET "TenantId" = (SELECT u."TenantId" FROM "Users" u WHERE u."Id" = t."CreatedBy" AND u."TenantId" IS NOT NULL LIMIT 1)
WHERE t."TenantId" IS NULL;
UPDATE "InvoiceTemplates" t
SET "TenantId" = (SELECT "Id" FROM "Tenants" ORDER BY "Id" ASC LIMIT 1)
WHERE t."TenantId" IS NULL;

-- =============================================================================
-- Purchases: AmountPaid, PaymentType, SupplierId (fixes column p.AmountPaid does not exist)
-- =============================================================================
ALTER TABLE "Purchases" ADD COLUMN IF NOT EXISTS "AmountPaid" numeric(18,2) NULL;
ALTER TABLE "Purchases" ADD COLUMN IF NOT EXISTS "PaymentType" varchar(20) NULL;
ALTER TABLE "Purchases" ADD COLUMN IF NOT EXISTS "SupplierId" integer NULL;

-- =============================================================================
-- Supplier tables (create only if not exist) - production-safe
-- =============================================================================
CREATE TABLE IF NOT EXISTS "SupplierCategories" (
  "Id" serial PRIMARY KEY,
  "TenantId" integer NULL,
  "Name" varchar(100) NOT NULL,
  "IsActive" boolean NOT NULL DEFAULT true,
  "CreatedAt" timestamp with time zone NOT NULL DEFAULT (now() AT TIME ZONE 'utc')
);
CREATE UNIQUE INDEX IF NOT EXISTS "IX_SupplierCategories_TenantId_Name" ON "SupplierCategories" ("TenantId", "Name");

CREATE TABLE IF NOT EXISTS "Suppliers" (
  "Id" serial PRIMARY KEY,
  "TenantId" integer NULL,
  "Name" varchar(200) NOT NULL,
  "NormalizedName" varchar(200) NOT NULL,
  "Phone" varchar(50) NULL,
  "Address" varchar(500) NULL,
  "CategoryId" integer NULL,
  "OpeningBalance" numeric(18,2) NOT NULL DEFAULT 0,
  "IsActive" boolean NOT NULL DEFAULT true,
  "CreatedAt" timestamp with time zone NOT NULL DEFAULT (now() AT TIME ZONE 'utc'),
  CONSTRAINT "FK_Suppliers_SupplierCategories_CategoryId" FOREIGN KEY ("CategoryId") REFERENCES "SupplierCategories" ("Id") ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS "IX_Suppliers_CategoryId" ON "Suppliers" ("CategoryId");
CREATE UNIQUE INDEX IF NOT EXISTS "IX_Suppliers_TenantId_NormalizedName" ON "Suppliers" ("TenantId", "NormalizedName");

CREATE TABLE IF NOT EXISTS "SupplierPayments" (
  "Id" serial PRIMARY KEY,
  "TenantId" integer NULL,
  "SupplierId" integer NOT NULL,
  "Amount" numeric(18,2) NOT NULL,
  "PaymentDate" timestamp with time zone NOT NULL,
  "Reference" varchar(200) NULL,
  "PurchaseId" integer NULL,
  "CreatedAt" timestamp with time zone NOT NULL DEFAULT (now() AT TIME ZONE 'utc'),
  CONSTRAINT "FK_SupplierPayments_Suppliers_SupplierId" FOREIGN KEY ("SupplierId") REFERENCES "Suppliers" ("Id") ON DELETE RESTRICT,
  CONSTRAINT "FK_SupplierPayments_Purchases_PurchaseId" FOREIGN KEY ("PurchaseId") REFERENCES "Purchases" ("Id") ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS "IX_SupplierPayments_SupplierId" ON "SupplierPayments" ("SupplierId");
CREATE INDEX IF NOT EXISTS "IX_SupplierPayments_PurchaseId" ON "SupplierPayments" ("PurchaseId");
CREATE INDEX IF NOT EXISTS "IX_SupplierPayments_PaymentDate" ON "SupplierPayments" ("PaymentDate");

-- FK Purchases -> Suppliers (only if constraint does not exist)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'FK_Purchases_Suppliers_SupplierId' AND table_name = 'Purchases'
  ) THEN
    ALTER TABLE "Purchases" ADD CONSTRAINT "FK_Purchases_Suppliers_SupplierId"
      FOREIGN KEY ("SupplierId") REFERENCES "Suppliers" ("Id") ON DELETE SET NULL;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS "IX_Purchases_SupplierId" ON "Purchases" ("SupplierId");
