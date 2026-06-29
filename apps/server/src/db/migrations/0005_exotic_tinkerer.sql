ALTER TABLE `agents` ADD `workflow` text;--> statement-breakpoint
ALTER TABLE `runs` ADD `session_id` text;--> statement-breakpoint
ALTER TABLE `runs` ADD `pending_gate` text;--> statement-breakpoint
ALTER TABLE `runs` ADD `pending_response` text;