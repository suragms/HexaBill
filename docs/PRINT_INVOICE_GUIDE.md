# How to Print an Invoice (Client Guide)

## Quick steps

1. **Save the invoice**  
   In POS, add items, set customer (if needed), and click **Save**. Wait for the success message.

2. **Click Print**  
   In the success modal, click the **Print** button.

3. **Select format**  
   Choose the format you need:
   - **A4 Invoice** – for office printer, full page
   - **A5 Invoice** – half page, same content as A4
   - **80mm Receipt** – standard POS counter printer
   - **58mm Receipt** – handheld POS (e.g. NETUM)

4. **Print**  
   Click **Print** in the dialog. The PDF opens in a new tab; use your browser’s print (Ctrl+P) or the print button to send to your printer.

## Tips

- **Thermal printers (80mm / 58mm):** Choose 80mm or 58mm so the receipt width matches your paper. Text is sized for thermal paper.
- **Same numbers everywhere:** Subtotal, VAT, and Total are the same in every format; they come from the saved invoice.
- **Gulf VAT:** All formats include company name, TRN, invoice number, date, items, VAT rate, VAT amount, and total in AED (or your currency).

## For developers

- **Where is the code?** See **`docs/PRINT_AND_TEMPLATE_INDEX.md`** for all print-format and HTML template locations and a **production / before-push checklist**.

## Troubleshooting

- **Print button does nothing:** Allow pop-ups for this site so the PDF tab can open.
- **Wrong paper size in print preview:** In the print dialog, set paper size to match your choice (A4, A5, or receipt width for 80mm/58mm).
- **58mm on NETUM / handheld:** Select “58mm Receipt”, then print; use the device’s default printer if it’s set to the thermal printer.
