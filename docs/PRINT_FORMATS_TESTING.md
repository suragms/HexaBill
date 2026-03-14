# Multi-Format Invoice Print – Testing Checklist

Use this checklist to verify invoice printing across A4, A5, 80mm, and 58mm formats (Gulf VAT compliant).

**Code index and production checklist:** For where all print/template code lives and a **before-push** checklist, see **`docs/PRINT_AND_TEMPLATE_INDEX.md`**.

---

## 1. Run the system and test the flow

1. Start backend and frontend (see project README).
2. Open POS.
3. Create a new sale invoice (add items, customer if needed).
4. Click **Save**.
5. Confirm the success modal appears.
6. Click **Print**.
7. **Format selector** should show:
   - A4 Invoice  
   - A5 Invoice  
   - 80mm Receipt  
   - 58mm Receipt  
8. For each format:
   - Choose the format and click Print.
   - **Verify:** PDF opens in a new tab.
   - **Verify:** Layout matches the format (A4 full page, A5 half page, 80mm/58mm narrow).
   - **Verify:** Print preview (Ctrl+P) looks correct for that format.

---

## 2. VAT calculation consistency (Gulf VAT compliance)

**Critical:** The same invoice must show the **same numbers** in every format.

- Print the **same** invoice in A4, A5, 80mm, and 58mm.
- Compare:
  - **Subtotal**
  - **VAT Total** (e.g. VAT 5%)
  - **Grand Total**
- Example: Subtotal 100.00, VAT 5% 5.00, Total 105.00 must be identical on all four.
- **If any format shows different values → bug.** All formats use the same saved invoice data (no recalculation in templates).

---

## 3. Required Gulf VAT fields

Every format (including 58mm) must include:

- [ ] Company name  
- [ ] TRN (Tax Registration Number)  
- [ ] Invoice number  
- [ ] Invoice date  
- [ ] Item list (description, qty, unit price / total as per layout)  
- [ ] VAT rate (e.g. 5%)  
- [ ] VAT amount  
- [ ] Total including VAT  
- [ ] Currency (AED)

---

## 4. Thermal layout (80mm and 58mm)

**80mm**

- Table should fit like:  
  `Item      Qty    Total`  
  `Chicken    2     20.00`  
  `Rice       1     10.00`
- No text overflow; readable on 80mm paper.

**58mm**

- Even tighter layout, e.g.:  
  `Chicken x2  20.00`  
  `Rice x1     10.00`
- No overflow; readable on 58mm paper.

---

## 5. Test with client POS device (NETUM Android POS)

- Open POS on the device.
- Create an invoice and save.
- Print → choose **58mm Receipt**.
- **Verify:** Printer prints correctly, text readable, no clipping.

---

## 6. Print preview

For each format, open the PDF and press **Ctrl+P** (or Cmd+P):

- **A4** → Paper size A4.  
- **A5** → Paper size A5.  
- **80mm** → Receipt / narrow width.  
- **58mm** → Receipt / narrow width.

If 58mm PDF shows as A4 in preview, page size in the PDF is wrong and should be fixed.

---

## 7. API check

1. Open browser DevTools → **Network** tab.
2. Create/save an invoice, click Print, then choose a format and click Print in the modal.
3. Find the request: `GET /api/sales/{id}/pdf?format=...`
4. **Verify:** Query parameter appears with the chosen format, e.g.:
   - `?format=A5`
   - `?format=80mm`
   - `?format=58mm`

---

## 8. Regression tests

Ensure these still work:

- [ ] Invoice PDF from Sales page (e.g. Sales Ledger or Billing History).
- [ ] Old A4 printing (default when no format or format=A4).
- [ ] Email invoice.
- [ ] Download invoice (Download PDF button).

---

## 9. Client documentation

- [ ] Client guide added: [docs/PRINT_INVOICE_GUIDE.md](PRINT_INVOICE_GUIDE.md) – “Save → Print → Select format → Print”.

---

## 10. Final production checklist

Before release, confirm:

- [ ] A4 invoice unchanged from previous behaviour.
- [ ] A5 invoice readable and complete.
- [ ] 80mm receipt aligned and readable.
- [ ] 58mm receipt aligned and readable.
- [ ] VAT totals match across all formats.
- [ ] TRN visible on all formats.
- [ ] Date and invoice number visible on all formats.
- [ ] Print preview correct per format.
- [ ] Works on POS device (e.g. NETUM 58mm).

---

## 11. Optional improvement (later)

- **Auto device detection:** e.g. POS device → default 58mm; desktop → default A4.

---

## API reference

- `GET /api/sales/{id}/pdf?format=A4|A5|80mm|58mm`  
  Returns PDF for the chosen format. Default is A4 if `format` is omitted or invalid.

---

## Notes

- All formats use the **same** invoice data (SaleDto). Subtotal, VAT total, and grand total are **never recalculated** in the template.
- Required Gulf VAT fields: supplier name, TRN, invoice number, date, customer name (where applicable), item details, VAT rate, VAT amount, total including VAT, currency (AED).
