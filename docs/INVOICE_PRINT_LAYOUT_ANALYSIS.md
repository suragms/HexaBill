# Invoice Print Layout – Deep Analysis

**Date:** 2026-03-15  
**Scope:** A5, 80mm, 58mm invoice formats – structure, table, print quality

---

## 1. Executive Summary

Screenshots and test prints show recurring issues across all three formats:

| Issue | A5 | 80mm | 58mm |
|-------|----|------|------|
| Table columns overlapping / broken text | ✓ | ✓ | ✓ |
| Large visual gap (Item ↔ Qty/Total) | ✓ | ✓ | ✓ |
| Summary labels far from values | ✓ | ✓ | ✓ |
| All monetary values 0.00 | ✓ | ✓ | ✓ |
| Company address / Cust TRN missing | ✓ | ✓ | ✓ |
| Excessive white space | ✓ | ✓ | ✓ |
| Unit/Price column causing overflow | ✓ | - | - |

---

## 2. Root Causes

### 2.1 Layout / Table Structure

**A5 (148×210mm):**
- **Cause:** Too many fixed-width columns (7: #, Item, Qty, Unit, Price, Total, VAT) in ~140mm content width.
- **QuestPDF behavior:** `ConstantColumn` + `RelativeColumn` distribute space; narrow constants cause wrapping → "To tal", "VA T 5%", "Am ou nt".
- **Fix:** Simplify to **5 columns** (# | Item | Qty | Total | VAT). Remove Unit and Price to avoid overflow; Total covers line amount.

**80mm (~227pt usable width):**
- **Cause:** `RelativeColumn(3)` for Item takes all leftover space (≈135pt). Short item names leave a large gap before Qty/Total.
- **Fix:** Tighten Qty/Total constants (e.g. 24+44pt). Right-align summary labels so "Subtotal" sits next to the value.

**58mm (~164pt usable width):**
- **Cause:** Same as 80mm; summary labels span Item+Qty, pushing values far right.
- **Fix:** Right-align summary label cells (`.AlignRight()`) so "Sub", "VAT5%", "TOTAL" sit adjacent to their values. Reduce footer white space.

### 2.2 Financial Values All Zero

- **Cause:** SaleDto values (Subtotal, VatTotal, GrandTotal) and SaleItemDto (LineTotal, VatAmount) come from DB. Zero values indicate:
  1. **Intentional:** `IsZeroInvoice` or free/sample sale.
  2. **Data:** Product with UnitPrice=0 or incorrect POS entry.
  3. **Calculation:** Bug in `CreateSale` / `UpdateSale` not computing totals.
- **Not a PDF bug:** PDF only renders what SaleDto provides. Need to trace POS → Sale creation.

### 2.3 Business Identity Missing

- **Company address:** A5 shows "Mob | Address" but some layouts omit it.
- **Customer TRN:** Blank in screenshots – may be null in DB or customer not set. Required for UAE VAT invoices.
- **Fix:** Ensure `GetCompanySettingsAsync` and `GetCustomerTrnAsync` return values; template should show placeholders when empty.

---

## 3. Column Math (QuestPDF points)

| Format | Page width | Margins | Content width | Fixed cols | Item (flex) |
|--------|------------|---------|---------------|------------|-------------|
| A5 | 148mm | 8mm | ~140mm (≈396pt) | 16+24+38+32=110pt | ~286pt |
| 80mm | 80mm | 4mm | ~76mm (≈215pt) | 24+44=68pt | ~147pt |
| 58mm | 58mm | 3mm | ~55mm (≈156pt) | 20+38=58pt | ~98pt |

---

## 4. Fixes Applied

1. **A5:** Reduced to 5 columns (#|Item|Qty|Total|VAT); fixed widths to prevent overflow.
2. **80mm:** Reduced Qty/Total constants; right-align summary labels.
3. **58mm:** Right-align summary labels; compact footer.
4. **All:** Company address in header where missing; ensure Cust TRN is passed.

---

## 5. Remaining / Follow-up

- **All-zero values:** Trace POS flow → Sale creation; validate Subtotal/VatTotal/GrandTotal.
- **Arabic RTL:** Table alignment for Arabic descriptions; consider `DirectionFromRightToLeft()` on item cells.
- **Thermal 58/80mm:** Consider QR code, barcode for invoice reference (optional).
