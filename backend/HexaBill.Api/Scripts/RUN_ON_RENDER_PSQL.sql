-- =============================================================================
-- PASTE THIS ENTIRE FILE INTO RENDER PSQL (Connect → PSQL)
-- Fixes: 42703 column e.TenantId / e0.TenantId, errorMissingColumn (ErrorLogs.ResolvedAt, etc.)
-- Run once, then restart your HexaBill API on Render.
-- =============================================================================

-- ErrorLogs: create if missing (so /api/error-logs and SaveChanges don't throw). Add ResolvedAt when table exists.
CREATE TABLE IF NOT EXISTS "ErrorLogs" (
  "Id" SERIAL PRIMARY KEY,
  "TraceId" VARCHAR(64) NOT NULL,
  "ErrorCode" VARCHAR(64) NOT NULL,
  "Message" VARCHAR(2000) NOT NULL,
  "StackTrace" TEXT,
  "Path" VARCHAR(500),
  "Method" VARCHAR(16),
  "TenantId" INTEGER,
  "UserId" INTEGER,
  "CreatedAt" timestamp with time zone NOT NULL DEFAULT (now() AT TIME ZONE 'utc'),
  "ResolvedAt" timestamp with time zone NULL
);
CREATE INDEX IF NOT EXISTS "IX_ErrorLogs_CreatedAt" ON "ErrorLogs" ("CreatedAt");
CREATE INDEX IF NOT EXISTS "IX_ErrorLogs_TenantId" ON "ErrorLogs" ("TenantId");
CREATE INDEX IF NOT EXISTS "IX_ErrorLogs_ErrorCode" ON "ErrorLogs" ("ErrorCode");
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'ErrorLogs') THEN
    ALTER TABLE "ErrorLogs" ADD COLUMN IF NOT EXISTS "ResolvedAt" timestamp with time zone NULL;
    CREATE INDEX IF NOT EXISTS "IX_ErrorLogs_ResolvedAt" ON "ErrorLogs" ("ResolvedAt");
  END IF;
END $$;

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
ALTER TABLE "Purchases" ADD COLUMN IF NOT EXISTS "DueDate" timestamp with time zone NULL;

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

-- ERP model uses SupplierName (fixes column s.SupplierName does not exist)
ALTER TABLE "SupplierPayments" ADD COLUMN IF NOT EXISTS "SupplierName" character varying(200) NULL;
ALTER TABLE "SupplierPayments" ADD COLUMN IF NOT EXISTS "Mode" character varying(20) NULL;
ALTER TABLE "SupplierPayments" ADD COLUMN IF NOT EXISTS "Notes" character varying(500) NULL;
ALTER TABLE "SupplierPayments" ADD COLUMN IF NOT EXISTS "CreatedBy" integer NOT NULL DEFAULT 1;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='SupplierPayments' AND column_name='SupplierId') THEN
    ALTER TABLE "SupplierPayments" ALTER COLUMN "SupplierId" DROP NOT NULL;
  END IF;
END $$;

-- SupplierLedgerCredits – vendor discounts/credits (reduces supplier outstanding). Required for /api/suppliers/summary.
CREATE TABLE IF NOT EXISTS "SupplierLedgerCredits" (
  "Id" serial PRIMARY KEY,
  "TenantId" integer NOT NULL,
  "SupplierName" character varying(200) NOT NULL,
  "Amount" numeric(18,2) NOT NULL,
  "CreditDate" timestamp with time zone NOT NULL,
  "CreditType" character varying(50) NOT NULL,
  "Notes" character varying(500) NULL,
  "CreatedBy" integer NOT NULL,
  "CreatedAt" timestamp with time zone NOT NULL DEFAULT (now() AT TIME ZONE 'utc')
);
CREATE INDEX IF NOT EXISTS "IX_SupplierLedgerCredits_TenantId_SupplierName" ON "SupplierLedgerCredits" ("TenantId", "SupplierName");
CREATE INDEX IF NOT EXISTS "IX_SupplierLedgerCredits_CreditDate" ON "SupplierLedgerCredits" ("CreditDate");

-- Suppliers: IsActive, UpdatedAt, Email, CreditLimit, PaymentTerms (for Create Supplier)
ALTER TABLE "Suppliers" ADD COLUMN IF NOT EXISTS "IsActive" boolean NOT NULL DEFAULT true;
ALTER TABLE "Suppliers" ADD COLUMN IF NOT EXISTS "UpdatedAt" timestamp with time zone NULL;
ALTER TABLE "Suppliers" ADD COLUMN IF NOT EXISTS "Email" character varying(200) NULL;
ALTER TABLE "Suppliers" ADD COLUMN IF NOT EXISTS "CreditLimit" numeric(18,2) NOT NULL DEFAULT 0;
ALTER TABLE "Suppliers" ADD COLUMN IF NOT EXISTS "PaymentTerms" character varying(100) NULL;
-- NormalizedName required for unique index and Create Supplier insert
ALTER TABLE "Suppliers" ADD COLUMN IF NOT EXISTS "NormalizedName" character varying(200) NULL;
UPDATE "Suppliers" SET "NormalizedName" = LOWER("Name") WHERE "NormalizedName" IS NULL;
DO $$ BEGIN IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='Suppliers' AND column_name='NormalizedName') THEN ALTER TABLE "Suppliers" ALTER COLUMN "NormalizedName" SET NOT NULL; END IF; EXCEPTION WHEN OTHERS THEN NULL; END $$;
CREATE UNIQUE INDEX IF NOT EXISTS "IX_Suppliers_TenantId_NormalizedName" ON "Suppliers" ("TenantId", "NormalizedName");
-- 42703 fix: column SupplierCategoryId/CategoryId does not exist (add both for compatibility)
ALTER TABLE "Suppliers" ADD COLUMN IF NOT EXISTS "CategoryId" integer NULL;
ALTER TABLE "Suppliers" ADD COLUMN IF NOT EXISTS "SupplierCategoryId" integer NULL;
CREATE INDEX IF NOT EXISTS "IX_Suppliers_CategoryId" ON "Suppliers" ("CategoryId");

-- CustomerVisits (fixes relation "CustomerVisits" does not exist)
CREATE TABLE IF NOT EXISTS "CustomerVisits" (
  "Id" serial PRIMARY KEY,
  "RouteId" integer NOT NULL,
  "CustomerId" integer NOT NULL,
  "TenantId" integer NOT NULL,
  "StaffId" integer NULL,
  "VisitDate" timestamp with time zone NOT NULL,
  "Status" character varying(50) NOT NULL DEFAULT 'NotVisited',
  "Notes" character varying(500) NULL,
  "PaymentCollected" numeric(18,2) NULL,
  "CreatedAt" timestamp with time zone NOT NULL DEFAULT (now() AT TIME ZONE 'utc'),
  "UpdatedAt" timestamp with time zone NULL,
  CONSTRAINT "FK_CustomerVisits_Routes_RouteId" FOREIGN KEY ("RouteId") REFERENCES "Routes" ("Id") ON DELETE CASCADE,
  CONSTRAINT "FK_CustomerVisits_Customers_CustomerId" FOREIGN KEY ("CustomerId") REFERENCES "Customers" ("Id") ON DELETE CASCADE,
  CONSTRAINT "FK_CustomerVisits_Tenants_TenantId" FOREIGN KEY ("TenantId") REFERENCES "Tenants" ("Id") ON DELETE CASCADE,
  CONSTRAINT "FK_CustomerVisits_Users_StaffId" FOREIGN KEY ("StaffId") REFERENCES "Users" ("Id") ON DELETE SET NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "IX_CustomerVisits_RouteId_CustomerId_VisitDate" ON "CustomerVisits" ("RouteId", "CustomerId", "VisitDate");
CREATE INDEX IF NOT EXISTS "IX_CustomerVisits_TenantId" ON "CustomerVisits" ("TenantId");
CREATE INDEX IF NOT EXISTS "IX_CustomerVisits_VisitDate" ON "CustomerVisits" ("VisitDate");

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

-- VendorDiscounts (fixes 42P01: relation "VendorDiscounts" does not exist - required for Supplier Ledger Vendor Discounts tab)
CREATE TABLE IF NOT EXISTS "VendorDiscounts" (
  "Id" serial PRIMARY KEY,
  "TenantId" integer NOT NULL,
  "SupplierId" integer NOT NULL,
  "PurchaseId" integer NULL,
  "Amount" numeric(18,2) NOT NULL,
  "DiscountDate" timestamp with time zone NOT NULL,
  "DiscountType" character varying(50) NOT NULL,
  "Reason" character varying(500) NOT NULL DEFAULT '',
  "IsActive" boolean NOT NULL DEFAULT true,
  "CreatedBy" integer NOT NULL,
  "CreatedAt" timestamp with time zone NOT NULL DEFAULT (now() AT TIME ZONE 'utc'),
  "UpdatedAt" timestamp with time zone NOT NULL DEFAULT (now() AT TIME ZONE 'utc'),
  CONSTRAINT "FK_VendorDiscounts_Suppliers_SupplierId" FOREIGN KEY ("SupplierId") REFERENCES "Suppliers" ("Id") ON DELETE RESTRICT,
  CONSTRAINT "FK_VendorDiscounts_Purchases_PurchaseId" FOREIGN KEY ("PurchaseId") REFERENCES "Purchases" ("Id") ON DELETE SET NULL,
  CONSTRAINT "FK_VendorDiscounts_Users_CreatedBy" FOREIGN KEY ("CreatedBy") REFERENCES "Users" ("Id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "IX_VendorDiscounts_TenantId" ON "VendorDiscounts" ("TenantId");
CREATE INDEX IF NOT EXISTS "IX_VendorDiscounts_SupplierId" ON "VendorDiscounts" ("SupplierId");
CREATE INDEX IF NOT EXISTS "IX_VendorDiscounts_PurchaseId" ON "VendorDiscounts" ("PurchaseId");
CREATE INDEX IF NOT EXISTS "IX_VendorDiscounts_CreatedBy" ON "VendorDiscounts" ("CreatedBy");

-- =============================================================================
-- Sales: fix NULL Subtotal/VatTotal (prevents "exception while iterating" / VAT return 500 in production)
-- =============================================================================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'Sales') THEN
    UPDATE "Sales" SET "Subtotal" = COALESCE("Subtotal", 0), "VatTotal" = COALESCE("VatTotal", 0)
    WHERE "Subtotal" IS NULL OR "VatTotal" IS NULL;
    ALTER TABLE "Sales" ADD COLUMN IF NOT EXISTS "IsZeroInvoice" boolean NOT NULL DEFAULT false;
    ALTER TABLE "Sales" ADD COLUMN IF NOT EXISTS "VatScenario" character varying(20) NULL;
    UPDATE "Sales" SET "VatScenario" = COALESCE("VatScenario", 'Standard') WHERE "VatScenario" IS NULL OR TRIM("VatScenario") = '';
  END IF;
END $$;
