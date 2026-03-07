# Vendor Discounts API

Vendor Discounts are for **private tracking only**. They do **not** affect ledger, supplier balance, cash flow, purchase reports, or P&L.

## Authentication and authorization

- All endpoints require `Authorization: Bearer <token>`.
- **Roles:** Owner or Admin only. Staff receive 403 Forbidden.

## Base path

```
/api/suppliers/{supplierId}/vendor-discounts
```

`supplierId` is the numeric ID of the supplier from the Suppliers table (from `GET /api/suppliers/by-name/{supplierName}`).

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/suppliers/{supplierId}/vendor-discounts` | List all active vendor discounts for the supplier and total savings |
| GET | `/api/suppliers/{supplierId}/vendor-discounts/{id}` | Get a single vendor discount by id |
| POST | `/api/suppliers/{supplierId}/vendor-discounts` | Create a new vendor discount |
| PUT | `/api/suppliers/{supplierId}/vendor-discounts/{id}` | Update an existing vendor discount |
| DELETE | `/api/suppliers/{supplierId}/vendor-discounts/{id}` | Soft-delete a vendor discount (sets IsActive = false) |

## Request/response

### GET list response

```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": 1,
        "supplierId": 1,
        "purchaseId": null,
        "purchaseInvoiceNo": null,
        "amount": 150.00,
        "discountDate": "2025-03-01",
        "discountType": "Cash Discount",
        "reason": "5% bulk order discount",
        "createdByUserName": "Admin User",
        "createdAt": "2025-03-01T10:00:00Z",
        "updatedAt": "2025-03-01T10:00:00Z"
      }
    ],
    "totalSavings": 150.00
  }
}
```

### POST / PUT body (CreateOrUpdateVendorDiscountRequest)

| Field | Type | Required | Validation |
|-------|------|----------|------------|
| purchaseId | int? | No | If provided, must exist and belong to this supplier |
| amount | decimal | Yes | Must be > 0 |
| discountDate | date | Yes | Cannot be in the future |
| discountType | string | Yes | e.g. Cash Discount, Free Products, Promotional Offer, Negotiated Discount |
| reason | string | Yes | Min 3 characters |

## Isolation (no accounting impact)

- **Ledger:** Built from Purchases and SupplierPayments only. VendorDiscounts are never included.
- **Supplier balance:** `Total Purchases - Returns - Payments`. VendorDiscounts are not subtracted.
- **Cash flow / reports:** Do not query VendorDiscounts.
- **P&L:** Vendor discounts are not treated as income or expense.

See inline comments in `SupplierService`, `ReportService`, and `VendorDiscountService` for isolation details.
