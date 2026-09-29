ALTER TABLE `crawl_runs` ADD `created_at` text NOT NULL DEFAULT '';--> statement-breakpoint
ALTER TABLE `crawl_runs` ADD `updated_at` text NOT NULL DEFAULT '';--> statement-breakpoint
UPDATE `crawl_runs` SET `created_at` = `started_at`, `updated_at` = coalesce(`finished_at`, `started_at`);
