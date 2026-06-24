ALTER TABLE `agents` ADD `avatar_key` text;--> statement-breakpoint
ALTER TABLE `agents` ADD `title` text;--> statement-breakpoint
ALTER TABLE `agents` ADD `bio` text;--> statement-breakpoint
ALTER TABLE `agents` ADD `skills` text DEFAULT '[]' NOT NULL;