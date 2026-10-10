CREATE TABLE `audio_files` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`cache_key` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `audio_user_cache_idx` ON `audio_files` (`user_id`,`cache_key`);--> statement-breakpoint
CREATE TABLE `exercises` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`sense_id` text NOT NULL,
	`kind` text NOT NULL,
	`stage` text NOT NULL,
	`data` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `exercises_user_kind_idx` ON `exercises` (`user_id`,`kind`);--> statement-breakpoint
CREATE TABLE `request_limits` (
	`key` text PRIMARY KEY NOT NULL,
	`count` integer DEFAULT 0 NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `senses` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`word` text NOT NULL,
	`phonetic` text DEFAULT '' NOT NULL,
	`pos` text NOT NULL,
	`meaning` text NOT NULL,
	`definition` text NOT NULL,
	`learned` integer DEFAULT false NOT NULL,
	`mastery` integer DEFAULT 0 NOT NULL,
	`review_count` integer DEFAULT 0 NOT NULL,
	`materials` text DEFAULT '[]' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `senses_user_word_idx` ON `senses` (`user_id`,`word`);--> statement-breakpoint
CREATE TABLE `user_settings` (
	`user_id` text PRIMARY KEY NOT NULL,
	`text_model` text NOT NULL,
	`voice_model` text NOT NULL
);
