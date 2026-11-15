CREATE TABLE "revoked_access_tokens" (
	"jti" text PRIMARY KEY NOT NULL,
	"valid_after" bigint NOT NULL,
	"expires_at" bigint
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "tokens_valid_after" bigint;--> statement-breakpoint
CREATE INDEX "revoked_access_tokens_expires_at" ON "revoked_access_tokens" USING btree ("expires_at");