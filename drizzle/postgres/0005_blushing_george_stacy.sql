CREATE TABLE "asset_objects" (
	"collection" text NOT NULL,
	"asset_path" text NOT NULL,
	"sha256" text NOT NULL,
	"byte_size" bigint NOT NULL,
	"pinned" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"unreferenced_at" timestamp with time zone,
	CONSTRAINT "asset_objects_collection_asset_path_pk" PRIMARY KEY("collection","asset_path"),
	CONSTRAINT "asset_objects_collection_check" CHECK ("asset_objects"."collection" IN ('assets', 'userassets')),
	CONSTRAINT "asset_objects_sha256_check" CHECK ("asset_objects"."sha256" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "asset_objects_size_check" CHECK ("asset_objects"."byte_size" >= 0),
	CONSTRAINT "asset_objects_path_check" CHECK (("asset_objects"."collection" = 'assets' AND "asset_objects"."asset_path" ~ ('^uploads/' || "asset_objects"."sha256" || '\.[a-z0-9]+$')) OR ("asset_objects"."collection" = 'userassets' AND "asset_objects"."asset_path" ~ ('^' || "asset_objects"."sha256" || '\.[a-z0-9]+$')))
);
--> statement-breakpoint
CREATE TABLE "asset_references" (
	"id" text PRIMARY KEY NOT NULL,
	"collection" text NOT NULL,
	"asset_path" text NOT NULL,
	"reference_type" text DEFAULT 'permalink' NOT NULL,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "asset_references_type_check" CHECK ("asset_references"."reference_type" = 'permalink')
);
--> statement-breakpoint
ALTER TABLE "asset_references" ADD CONSTRAINT "asset_references_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_references" ADD CONSTRAINT "asset_references_object_fk" FOREIGN KEY ("collection","asset_path") REFERENCES "public"."asset_objects"("collection","asset_path") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "asset_objects_gc" ON "asset_objects" USING btree ("unreferenced_at","collection","asset_path");--> statement-breakpoint
CREATE INDEX "asset_references_object" ON "asset_references" USING btree ("collection","asset_path");