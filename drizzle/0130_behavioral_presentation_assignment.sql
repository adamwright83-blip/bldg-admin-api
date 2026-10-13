-- A selection receipt is distinct from delivered or viewable presentation.
ALTER TABLE behavioral_ledger_events MODIFY COLUMN eventType enum('DELIVERED','VIEWABLE','ENGAGED','ACCEPTED','STARTED','COMPLETED','VERIFIED','DEFERRED','DISMISSED','EXPIRED','SUPERSEDED','NOT_COMPLETED','ASSIGNED') NOT NULL;
