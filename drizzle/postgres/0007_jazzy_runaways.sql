ALTER TABLE "users" ALTER COLUMN "is_admin" DROP DEFAULT;
ALTER TABLE "users" ALTER COLUMN "is_admin" SET DATA TYPE integer USING "is_admin"::integer;
ALTER TABLE "users" ALTER COLUMN "is_admin" SET DEFAULT 0;
