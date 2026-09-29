CREATE TABLE `companies` (
	`siren` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`legal_name` text NOT NULL,
	`trade_names` text DEFAULT '[]' NOT NULL,
	`naf_code` text NOT NULL,
	`naf_label` text,
	`headcount_range` text,
	`headcount_year` text,
	`company_category` text,
	`founded_at` text,
	`siret_local` text NOT NULL,
	`address` text,
	`postal_code` text,
	`city` text,
	`latitude` real NOT NULL,
	`longitude` real NOT NULL,
	`headquarters_in_zone` integer DEFAULT true NOT NULL,
	`finances` text,
	`website` text,
	`website_source` text,
	`website_confidence` real,
	`careers_url` text,
	`github_org` text,
	`linkedin_url` text,
	`description` text,
	`last_crawled_at` text,
	`raw_sirene` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `companies_lat_lon` ON `companies` (`latitude`,`longitude`);--> statement-breakpoint
CREATE INDEX `companies_naf` ON `companies` (`naf_code`);--> statement-breakpoint
CREATE TABLE `company_status` (
	`profile_id` integer NOT NULL,
	`siren` text NOT NULL,
	`status` text DEFAULT 'to_review' NOT NULL,
	`notes` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`profile_id`, `siren`),
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`siren`) REFERENCES `companies`(`siren`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `company_tech` (
	`siren` text NOT NULL,
	`tag_slug` text NOT NULL,
	`source` text NOT NULL,
	`confidence` real NOT NULL,
	`evidence` text,
	`detected_at` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`siren`, `tag_slug`, `source`),
	FOREIGN KEY (`siren`) REFERENCES `companies`(`siren`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tag_slug`) REFERENCES `tech_tags`(`slug`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `company_tech_tag` ON `company_tech` (`tag_slug`);--> statement-breakpoint
CREATE TABLE `crawl_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`command` text NOT NULL,
	`args` text DEFAULT '{}' NOT NULL,
	`started_at` text NOT NULL,
	`finished_at` text,
	`stats` text,
	`errors` text DEFAULT '[]' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `employer_aliases` (
	`employer_name_normalized` text PRIMARY KEY NOT NULL,
	`siren` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`siren`) REFERENCES `companies`(`siren`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `job_offers` (
	`id` text PRIMARY KEY NOT NULL,
	`source` text DEFAULT 'france_travail' NOT NULL,
	`siren` text,
	`employer_name` text,
	`title` text NOT NULL,
	`description` text,
	`url` text,
	`contract_type` text,
	`published_at` text,
	`updated_at_source` text,
	`latitude` real,
	`longitude` real,
	`city` text,
	`is_active` integer DEFAULT true NOT NULL,
	`last_seen_run_id` integer,
	`raw` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`siren`) REFERENCES `companies`(`siren`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `job_offers_siren` ON `job_offers` (`siren`);--> statement-breakpoint
CREATE INDEX `job_offers_active` ON `job_offers` (`is_active`);--> statement-breakpoint
CREATE TABLE `profiles` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`home_label` text NOT NULL,
	`home_latitude` real NOT NULL,
	`home_longitude` real NOT NULL,
	`radius_km` real NOT NULL,
	`skills` text DEFAULT '[]' NOT NULL,
	`headcount_ranges` text DEFAULT '[]' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `signals` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`siren` text NOT NULL,
	`kind` text NOT NULL,
	`value` real,
	`evidence` text,
	`detected_at` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`siren`) REFERENCES `companies`(`siren`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `signals_siren_kind` ON `signals` (`siren`,`kind`);--> statement-breakpoint
CREATE TABLE `tech_tags` (
	`slug` text PRIMARY KEY NOT NULL,
	`label` text NOT NULL,
	`category` text NOT NULL,
	`aliases` text NOT NULL,
	`context_required` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
