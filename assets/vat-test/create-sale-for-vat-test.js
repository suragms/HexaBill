/**
 * Create a sale via API for VAT Return E2E testing.
 * Run: node create-sale-for-vat-test.js
 *
 * Prerequisites:
 * - Backend running on http://localhost:5000
 * - Product with id=1 exists (or change PRODUCT_ID below)
 * - Get JWT: login at http://localhost:5173, open DevTools > Application > Local Storage,
 *   copy the value of the key that holds the token (e.g. hexabill_token or similar).
 *
 * Usage:
 * 1. Login in browser, copy token from localStorage
 * 2. TOKEN="your-jwt-here" node create-sale-for-vat-test.js
 */
const PRODUCT_ID = 1
const BASE = process.env.API_URL || 'http://localhost:5000'
const TOKEN = process.env.TOKEN || process.env.JWT

if (!TOKEN) {
  console.error('Set TOKEN or JWT env var with a valid JWT from browser login.')
  process.exit(1)
}

async function createSale() {
  const body = {
    customerId: null,
    items: [
      { productId: PRODUCT_ID, unitType: 'CRTN', qty: 1, unitPrice: 100 }
    ],
    discount: 0,
    payments: [{ method: 'Cash', amount: 105 }],
    invoiceDate: '2026-02-15T12:00:00.000Z' // Q1 2026
  }

  const res = await fetch(`${BASE}/api/sales`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${TOKEN}`
    },
    body: JSON.stringify(body)
  })

  if (!res.ok) {
    const txt = await res.text()
    throw new Error(`API ${res.status}: ${txt}`)
  }

  const data = await res.json()
  console.log('Sale created:', data?.data?.invoiceNo, data?.data?.id)
  return data?.data
}

createSale().catch((e) => {
  console.error(e)
  process.exit(1)
})
