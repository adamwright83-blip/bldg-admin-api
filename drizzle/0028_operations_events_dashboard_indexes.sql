CREATE INDEX `idx_operations_events_event_type` ON `operations_events` (`sourceEventType`);
--> statement-breakpoint
CREATE INDEX `idx_operations_events_customer_name` ON `operations_events` (`customerName`);
--> statement-breakpoint
CREATE INDEX `idx_operations_events_vendor` ON `operations_events` (`vendorId`);
