# Subsystem Contract: Commercial

## PURPOSE
Authoritative domain owner for B2B commercial accounts, sales pipelines, outreach visits, proposal management, and commercial conversion (`won`).

## OWNS
- Commercial account records and pipeline stages.
- Commercial outreach missions and visit attestations.
- Conversion authority: marking an account `won` (accepted commercial verbal/contract agreement).
- Canonical commercial account and follow-up read services.

## READS
- Verified operator visit attestations (`server/field/`).
- Admitted tenant context.

## WRITES
- Commercial account and pipeline tables.
- Proposal status and follow-up records.

## LEGAL ENTRYPOINTS
- `commercialPipelineService.ts`
- `commercialAccountReadService.ts`
- `commercialFollowUpReadService.ts`

## DOWNSTREAM CONSUMERS
- Day Line daily sales tasks
- Claire briefing & conversational prompts
- Lantern City building unlock marks

## MUST NEVER OWN
- Native payment admission or captured dollar truth (`won` is NEVER paid revenue).
- Native laundry order lifecycle.
- Game progression mechanics.

## LEGACY/COMPATIBILITY EXCEPTIONS
- Retained legacy pipeline stages mapped strictly through conversion read models.
