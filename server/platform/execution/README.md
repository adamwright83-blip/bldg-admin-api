# Subsystem Contract: Platform Execution

## PURPOSE
Authoritative platform layer for durable background execution, leasing, heartbeats, retries, and outbox workers.

## OWNS
- Generic durable background step leases and heartbeats.
- Step execution concurrency controls and dead-letter queue expiration.
- Exponential backoff and retry scheduling for background processes.

## READS
- Store step claims and lease expiration timestamps.

## WRITES
- Step status updates (`running`, `completed`, `failed`, `dead_letter`).

## LEGAL ENTRYPOINTS
- `server/platform/execution/worker.ts`

## DOWNSTREAM CONSUMERS
- Persistent Operator goal cycles and appointments (`server/persistentOperator/`).
- Procurement workers (`server/procurement/`).
- President OS execution loops (`server/president/`).

## MUST NEVER OWN
- Business domain policy (orders, payments, commercial).
- Direct mutation of economic balances or receipts without domain admission.

## LEGACY/COMPATIBILITY EXCEPTIONS
- Generic durable execution interface shared across legacy DayForge background workers and modern agent loops.
