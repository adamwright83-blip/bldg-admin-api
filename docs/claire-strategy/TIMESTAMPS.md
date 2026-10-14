# Database timestamps (investigated 2026-10-14)

- Production MySQL runs in UTC: `@@system_time_zone = UTC`, `NOW() = UTC_TIMESTAMP()`.
  Stored TIMESTAMP values are correct UTC (a proposal row's `createdAt` equals its own `preparedAt`).
- The apparent +7h skew seen during acceptance came from ad-hoc read-only scripts on a Pacific-time
  laptop: mysql2 interprets returned values in the host's local zone by default.
- Production app servers (Railway) run in UTC, so production reads and writes were not shifted.
  The app's client is now pinned to UTC (`timezone=Z`, `server/db.ts`) so a non-UTC host cannot
  shift timestamps either. No data migration: no stored value was shown to be wrong.
- Local integration databases written before this change by a non-UTC host may hold shifted
  values; they are disposable.
- Planning dates are derived from `now` in the business timezone (`date-fns-tz`), never from
  database wall-clock values.
