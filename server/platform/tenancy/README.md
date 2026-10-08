# Subsystem Contract: Platform Tenancy

## PURPOSE
Authoritative platform layer for multi-tenant identity, tenant extraction, session binding, and tenant data isolation.

## OWNS
- Request-level tenant derivation (`tenantForAuthenticatedUser`).
- Platform administrator role verification (`isPlatformAdministrator`).
- Claire desk authorization and operator scoping (`claireOperatorScope`, `authorizeJoystickClaireDesk`).
- Explicit non-default tenant resolution. A missing tenant is treated as invalid or unresolved, never implicitly defaulted.

## READS
- Authenticated user session or token (`server/_core/context.ts`, `server/_core/sdk.ts`).
- SaaS membership and tenant access records (`server/saas/tenantAccess.ts`).

## WRITES
- Session context properties (read-only tenant context propagation).

## LEGAL ENTRYPOINTS
- `server/platform/tenancy/tenantIdentity.ts`

## DOWNSTREAM CONSUMERS
- `server/_core/context.ts`
- `server/_core/trpc.ts`
- All business domains, planning, agent, and experience routers and services.

## MUST NEVER OWN
- Laundry order lifecycle or business status progression.
- Payment admission or payment gateway webhooks.
- Conversational dialog policy or prompt construction.

## LEGACY/COMPATIBILITY EXCEPTIONS
- Historical `Laundry Farm` records retain legacy tenant binding semantics until explicit migration.
