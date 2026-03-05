-- =============================================================================
-- Backfill product stock from existing purchase items (Phase 2)
-- Run once after RUN_ON_RENDER_PSQL.sql when stock was not previously updated
-- from purchases. Respects TenantId; uses base units (Qty * ConversionToBase).
-- WARNING: This overwrites StockQty with purchase-only totals. If you have
-- sales that reduce stock, run this only on a copy or when stock is known to
-- be wrong and you will reconcile sales separately.
-- =============================================================================

-- Recompute Product.StockQty per product per tenant from PurchaseItems
-- (sum of Qty * ConversionToBase so we match app logic)
UPDATE "Products" AS prod
SET
  "StockQty" = sub.total_base_qty,
  "UpdatedAt" = (now() AT TIME ZONE 'utc')
FROM (
  SELECT
    pi."ProductId",
    COALESCE(p."TenantId", p."OwnerId") AS tenant_id,
    SUM(pi."Qty" * CASE WHEN pprod."ConversionToBase" > 0 THEN pprod."ConversionToBase" ELSE 1 END) AS total_base_qty
  FROM "PurchaseItems" pi
  INNER JOIN "Purchases" p ON p."Id" = pi."PurchaseId"
  INNER JOIN "Products" pprod ON pprod."Id" = pi."ProductId"
  GROUP BY pi."ProductId", COALESCE(p."TenantId", p."OwnerId")
) AS sub
WHERE prod."Id" = sub."ProductId"
  AND COALESCE(prod."TenantId", prod."OwnerId") = sub.tenant_id;

-- Optional: set stock to 0 for products that have no purchase items
-- (uncomment if you want products with no purchases to show 0)
-- UPDATE "Products" prod
-- SET "StockQty" = 0, "UpdatedAt" = (now() AT TIME ZONE 'utc')
-- WHERE NOT EXISTS (
--   SELECT 1 FROM "PurchaseItems" pi
--   INNER JOIN "Purchases" p ON p."Id" = pi."PurchaseId"
--   WHERE pi."ProductId" = prod."Id"
--   AND COALESCE(p."TenantId", p."OwnerId") = COALESCE(prod."TenantId", prod."OwnerId")
-- );
