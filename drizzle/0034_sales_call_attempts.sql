-- Bold Pitch (Saleslay "call" weapon) — durable outbound sales call record.
-- Bridge-through-cellphone: Twilio dials the rep's own cellphone first
-- (repLegCallSid), then only once answered dials the lead/customer
-- (customerLegCallSid). Reward is granted only once the CUSTOMER leg
-- reaches >=20s connected duration, mirroring the existing Level 4 war
-- call-strike rule (server/level4Twilio.ts). repLegCallSid is unique so a
-- duplicate Twilio status callback can never create or reward a duplicate
-- attempt.
CREATE TABLE `sales_call_attempts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`tenant_id` varchar(64) NOT NULL DEFAULT 'default',
	`lead_id` int,
	`order_id` int,
	`rep_phone` varchar(30) NOT NULL,
	`customer_phone` varchar(30) NOT NULL,
	`caller_id` varchar(30) NOT NULL,
	`rep_leg_call_sid` varchar(64),
	`customer_leg_call_sid` varchar(64),
	`status` enum('dialing_rep','rep_connected','dialing_customer','customer_connected','completed_success','completed_no_connect','failed') NOT NULL DEFAULT 'dialing_rep',
	`customer_leg_duration_sec` int,
	`recording_enabled` boolean NOT NULL DEFAULT false,
	`reward_granted` boolean NOT NULL DEFAULT false,
	`failure_reason` varchar(255),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `sales_call_attempts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sales_call_attempts_rep_leg_call_sid_idx` ON `sales_call_attempts` (`rep_leg_call_sid`);
