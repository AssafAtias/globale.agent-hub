CREATE TABLE `agent_memory` (
	`id` text PRIMARY KEY NOT NULL,
	`agent_id` text NOT NULL,
	`run_id` text,
	`note` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `agents` ADD `focus` text;