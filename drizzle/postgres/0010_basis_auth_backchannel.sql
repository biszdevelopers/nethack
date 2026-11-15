CREATE TABLE "basis_access_token_revocations" (
	"issuer" text NOT NULL,
	"jti" text NOT NULL,
	"valid_after" bigint NOT NULL,
	"retain_until" bigint NOT NULL,
	CONSTRAINT "basis_access_token_revocations_issuer_jti_pk" PRIMARY KEY("issuer","jti")
);
--> statement-breakpoint
CREATE TABLE "basis_subject_logouts" (
	"issuer" text NOT NULL,
	"subject" text NOT NULL,
	"issued_at" bigint NOT NULL,
	CONSTRAINT "basis_subject_logouts_issuer_subject_pk" PRIMARY KEY("issuer","subject")
);
--> statement-breakpoint
CREATE INDEX "basis_access_token_revocations_retention_idx" ON "basis_access_token_revocations" USING btree ("retain_until");