# HexaBill Marketing Page Spec

Use this spec when building or updating the marketing site (e.g. hexadomain.com or a future `frontend-marketing` in this repo). Assets (screenshots, video) can be produced from this app and stored in this repo or the marketing repo.

## Page sections (recommended order)

1. **Hero** — Headline + subheadline + primary CTA (Start free trial / Book demo)
2. **Problem / Solution** — One line: "VAT-compliant invoicing and route sales in one app, built for Gulf distributors."
3. **Features** — Feature blocks with screenshot + short caption (see below)
4. **Pricing CTA** — Link to pricing or "Start free trial"
5. **Demo request / Trial CTA** — Form or button to request demo (existing DemoRequest API)
6. **Footer** — Links, contact, legal

## Feature list and screenshots

| Feature | Desktop screenshot | Mobile screenshot | Caption (1–2 sentences) |
|--------|---------------------|-------------------|-------------------------|
| Dashboard | `dashboard-desktop.png` | `dashboard-mobile.png` | See sales, returns, expenses, and profit at a glance. Filter by today, week, or month. |
| VAT-compliant invoicing | `invoices-desktop.png` | (optional) | Create and print VAT invoices with TRN. UAE 5% and multi-currency supported. |
| Route sales | `branches-routes-desktop.png` | (optional) | Manage branches and routes. Assign staff and customers to routes for delivery and field sales. |
| POS billing | `pos-desktop.png` | `pos-mobile.png` | Quick POS billing with product search, customer selection, and payment modes. |
| Reports | `reports-desktop.png` | (optional) | Sales report, profit & loss, outstanding bills, and staff performance by route. |
| Customer ledger | `ledger-desktop.png` | (optional) | Customer statements, payment history, and aging. |

Screenshots should be captured from a **demo tenant** with realistic Gulf data (AED, sample products, branches, routes). Store in `frontend/hexabill-ui/public/screenshots/` or the marketing repo’s assets folder.

## Video

- **Suggested length:** 60–90 seconds
- **Key scenes:** Login → Dashboard → (optional) Branches/Routes → Products → Create invoice → View report
- **Hosting:** YouTube/Vimeo or `frontend/hexabill-ui/public/video/hexabill-demo.mp4`
- **Embed:** Hero (background or inline) or Features section
- **Thumbnail:** Optional `hexabill-demo-thumb.png` in same folder as video

## Mobile screenshots

Capture at least: **Dashboard**, **POS**. Use browser DevTools device toolbar (e.g. iPhone 12, Pixel 5) or a real device. Same demo tenant. Naming: `{feature}-mobile.png`.

## Presentation ideas (for slides or marketing copy)

- **Differentiators:** Gulf VAT ready • Route sales out of the box • Branches + routes in one app • Arabic + English • One app for billing and field sales
- **Comparison:** "Zoho and QuickBooks weren’t built for route sales; we were."
- **Use cases:** F&B distributor, FMCG wholesaler, multi-branch retailer
- **One-liner:** "The Gulf’s billing and route sales platform — VAT-compliant invoices and routes in one place."

## Asset checklist

- [ ] `dashboard-desktop.png`
- [ ] `dashboard-mobile.png`
- [ ] `invoices-desktop.png` (or Sales Ledger)
- [ ] `branches-routes-desktop.png`
- [ ] `pos-desktop.png`
- [ ] `pos-mobile.png`
- [ ] `reports-desktop.png`
- [ ] `ledger-desktop.png` (optional)
- [ ] Demo video (link or file)
- [ ] Demo thumbnail (optional)

## Capture process

1. Run app locally (or staging) with a demo tenant that has branches, routes, products, and customers.
2. **Desktop:** Fixed viewport (e.g. 1280×720) or full screen; capture each key screen.
3. **Mobile:** DevTools device mode or real device; capture Dashboard and POS.
4. **Video:** Screen record (OBS, Loom) following: Login → Dashboard → (optional) open Branches → Products → create one invoice → open Reports. Keep under 2 minutes.
5. Save files to `frontend/hexabill-ui/public/screenshots/` and optionally `public/video/`; update this spec if paths differ.
