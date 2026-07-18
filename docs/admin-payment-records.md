# Admin Payment Records

Issue: `feat: add admin payment records dashboard with safe transaction details`

## Security-first design

The legacy `/api/admin/payments` controller returned complete Mongoose payment
documents. Those documents contain nested mock card details, including full card
numbers and CVV values.

The replacement controller:

- Returns a strict, manually constructed DTO.
- Never returns CVV, expiry, password, JWT, or raw card detail objects.
- Returns only a masked card identifier when a usable number exists.
- Escapes regex search input.
- Validates filters, dates, sorting, page, and page size.
- Uses the existing admin authentication and authorization middleware.

## Endpoint

```http
GET /api/admin/payments
Authorization: Bearer <admin-token>
```

Query parameters:

| Parameter | Supported values |
|---|---|
| `page` | Positive integer |
| `limit` | 1–50 |
| `search` | Transaction ID, student name/email, or course title |
| `status` | `successful`, `pending`, `failed` |
| `startDate` | ISO date or `YYYY-MM-DD` |
| `endDate` | ISO date or `YYYY-MM-DD` |
| `sort` | `newest`, `oldest`, `amount-asc`, `amount-desc` |

## Status compatibility

Existing payment documents default to `enrolled`. The API normalizes legacy
values as follows:

- `enrolled`, `paid`, `completed`, `success` → `successful`
- `declined`, `rejected`, `cancelled` → `failed`
- Unknown values → `pending`

No data migration is required.

## Amount

The original payment model does not contain a separate amount field. The API
uses the populated course's `C_price` value and safely parses its numeric amount.

## Frontend

The Payments section provides:

- Transaction, success, attention, and mock-revenue summaries
- Search
- Status and date filters
- Newest/oldest and amount sorting
- Pagination and page size
- Loading, empty, and retry states
- Responsive desktop and mobile layouts
- A safe transaction-details dialog

## Testing security

Open the browser Network tab and inspect `/api/admin/payments`.

The response must not contain:

```text
cvvcode
expmonthyear
password
token
cardDetails
```

A masked value such as `•••• •••• •••• 1234` may appear as `maskedCard`.
