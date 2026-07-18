# Admin Activity Logs

Issue: `feat: add admin activity log viewer with filters and pagination`

## API

`GET /api/admin/activity-logs`

Requires:

```http
Authorization: Bearer <admin-token>
```

Supported query parameters:

| Parameter | Values |
|---|---|
| `page` | Positive integer |
| `limit` | `1`–`50` |
| `search` | Email, role, activity, IP, or user-agent text |
| `role` | `admin`, `teacher`, `student` |
| `activity` | `login`, `logout` |
| `startDate` | ISO date or `YYYY-MM-DD` |
| `endDate` | ISO date or `YYYY-MM-DD` |
| `sort` | `newest`, `oldest` |

Example:

```text
/api/admin/activity-logs?page=1&limit=20&role=student&activity=login&sort=newest
```

## Security

- Authentication is enforced with `authMiddleware`.
- Authorization is enforced with `checkRole(["admin"])`.
- API responses expose only safe activity fields.
- Passwords, JWTs, card details, and other credentials are not selected or returned.
- Regex search input is escaped.
- Pagination and filter values are bounded and validated.

## Older records

The original activity schema did not store IP address or user agent. Older records therefore show `Not recorded`. The new schema fields are optional, so no data migration is required.

To record these fields in future login/logout handlers:

```js
await ActivityLog.create({
  userId: user._id,
  action: "login",
  role: user.type,
  email: user.email,
  ipAddress: req.ip,
  userAgent: req.get("user-agent"),
});
```

## Frontend

`AdminHome.jsx` now contains two sections:

- Users
- Activity Logs

The Activity Logs UI supports:

- Search
- Role and activity filters
- Date range
- Newest/oldest sorting
- Page size
- Pagination
- Refresh
- Loading, empty, and error states
- Responsive mobile cards

## Testing

1. Sign in as admin.
2. Open Admin Dashboard → Activity Logs.
3. Verify logs load.
4. Test each filter separately and in combination.
5. Enter an invalid date range and verify validation.
6. Test previous/next pagination.
7. Remove or alter the token and verify the API returns `401`.
8. Sign in as a non-admin user and verify the API returns `403`.
9. Check the browser response and confirm no sensitive fields are returned.
