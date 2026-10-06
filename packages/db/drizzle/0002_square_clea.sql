CREATE TABLE `cover_letters` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`profile_id` integer NOT NULL,
	`siren` text NOT NULL,
	`offer_id` text,
	`instruction` text,
	`content` text NOT NULL,
	`model` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`siren`) REFERENCES `companies`(`siren`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`offer_id`) REFERENCES `job_offers`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `cover_letters_profile_siren` ON `cover_letters` (`profile_id`,`siren`);--> statement-breakpoint
CREATE TABLE `offer_views` (
	`profile_id` integer NOT NULL,
	`offer_id` text NOT NULL,
	`seen_at` text NOT NULL,
	PRIMARY KEY(`profile_id`, `offer_id`),
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`offer_id`) REFERENCES `job_offers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `profiles` ADD `first_name` text;--> statement-breakpoint
ALTER TABLE `profiles` ADD `last_name` text;--> statement-breakpoint
ALTER TABLE `profiles` ADD `email` text;--> statement-breakpoint
ALTER TABLE `profiles` ADD `phone` text;--> statement-breakpoint
ALTER TABLE `profiles` ADD `postal_address` text;--> statement-breakpoint
ALTER TABLE `profiles` ADD `links` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `profiles` ADD `reveal_first_name` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `profiles` ADD `cv_filename` text;--> statement-breakpoint
ALTER TABLE `profiles` ADD `cv_text` text;--> statement-breakpoint
ALTER TABLE `profiles` ADD `cv_pages` integer;--> statement-breakpoint
ALTER TABLE `profiles` ADD `cv_uploaded_at` text;--> statement-breakpoint
ALTER TABLE `profiles` ADD `new_offer_days` integer DEFAULT 7 NOT NULL;