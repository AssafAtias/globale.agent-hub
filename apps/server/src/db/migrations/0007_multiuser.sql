ALTER TABLE `users` ADD `entra_object_id` text;--> statement-breakpoint
ALTER TABLE `users` ADD `name` text;--> statement-breakpoint
ALTER TABLE `runners` ADD `user_id` text;--> statement-breakpoint
ALTER TABLE `runs` ADD `user_id` text;--> statement-breakpoint
ALTER TABLE `agents` ADD `owner_id` text;--> statement-breakpoint

-- Bootstrap admin: created only if there are no users yet.
INSERT INTO `users` (id, email, role, name)
SELECT 'bootstrap-admin', 'bootstrap-admin@local', 'admin', 'Bootstrap Admin'
WHERE NOT EXISTS (SELECT 1 FROM `users`);--> statement-breakpoint

-- Backfill ownership on pre-existing rows to the first admin.
UPDATE `runners` SET `user_id` = (SELECT id FROM `users` WHERE role='admin' ORDER BY id LIMIT 1) WHERE `user_id` IS NULL;--> statement-breakpoint
UPDATE `runs`    SET `user_id` = (SELECT id FROM `users` WHERE role='admin' ORDER BY id LIMIT 1) WHERE `user_id` IS NULL;--> statement-breakpoint
UPDATE `agents`  SET `owner_id` = (SELECT id FROM `users` WHERE role='admin' ORDER BY id LIMIT 1) WHERE `owner_id` IS NULL;
