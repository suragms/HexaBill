-- ============================================================================
-- Migration: Add VatInclusive to Expenses
-- Date: 2026-03-12
-- Description: Persist whether expense amount was entered as VAT-inclusive or exclusive.
--              Additive only; nullable for backward compatibility.
-- PostgreSQL Production Ready - Idempotent (safe to run multiple times)
-- ============================================================================

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'Expenses' AND column_name = 'VatInclusive'
    ) THEN
        ALTER TABLE "Expenses" ADD COLUMN "VatInclusive" boolean NULL;
        RAISE NOTICE 'Added VatInclusive column to Expenses table';
    ELSE
        RAISE NOTICE 'VatInclusive column already exists on Expenses, skipping';
    END IF;
END $$;
