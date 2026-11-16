ALTER TABLE "labs" ADD COLUMN "blocks" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "labs" ADD COLUMN "control_questions" jsonb DEFAULT '[]'::jsonb NOT NULL;