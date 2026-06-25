ALTER TABLE `agents` ADD `sort_order` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `agents` ADD `archived` integer DEFAULT false NOT NULL;--> statement-breakpoint
UPDATE `agents` SET `sort_order` = (
  SELECT COUNT(*) FROM `agents` AS a2
  WHERE a2.created_at < `agents`.created_at
     OR (a2.created_at = `agents`.created_at AND a2.id < `agents`.id)
);