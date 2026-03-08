# Resident App → Admin Intake Integration

## Critical: Only confirm booking when admin handoff succeeds

**Do NOT show "Laundry booked..." unless the admin API returns 200 and `{ ok: true, orderId }`.**

If the POST to `/api/intake/from-bldg` fails (network error, 4xx, 5xx, or non-ok response), return a deterministic error to the user instead of fake success. Otherwise residents see a confirmation but no order exists in the admin DB.

## Required flow (resident app)

1. **Booking intent matched** — Log: `[LaundryBooking] Intent matched`
2. **Create service_request locally** (if applicable) — Log: `[LaundryBooking] Service request created: id=...`
3. **POST to admin intake** — Log: `[LaundryBooking] POST to admin intake attempted`
4. **Check response**:
   - `res.ok && res.status === 200`: Parse JSON
   - If `body.ok === true && typeof body.orderId === 'number'`: Success. Log: `[LaundryBooking] Admin handoff succeeded: orderId=...`. Show "Laundry booked...".
   - Else: Failure. Log: `[LaundryBooking] Admin handoff failed: status=${res.status} body=${JSON.stringify(body)}`. Do NOT show "Laundry booked". Return error to user.
5. **On fetch/network error** — Log: `[LaundryBooking] Admin intake error:`, err. Do NOT show "Laundry booked". Return: "We couldn't complete your booking. Please try again or contact support."

## Admin API contract

- **Endpoint:** `POST {LAUNDRY_API_BASE_URL}/api/intake/from-bldg`
- **Headers:** `x-app-shared-secret: {APP_SHARED_API_SECRET}`, `Content-Type: application/json`
- **Success (200):** `{ ok: true, orderId: number }`
- **Error (4xx/5xx):** `{ error: string, code?: "ADMIN_INTAKE_FAILED", message?: string }`

## Deterministic error handling

On any non-200 or `body.ok !== true`, treat as failure. Use `body.code === "ADMIN_INTAKE_FAILED"` to detect admin-side errors. Do not confirm booking.
