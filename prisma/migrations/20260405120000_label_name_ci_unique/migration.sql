-- Drop the existing case-sensitive unique constraint
DROP INDEX IF EXISTS "labels_name_user_id_key";

-- Create a case-insensitive unique index on (LOWER(name), user_id)
CREATE UNIQUE INDEX "labels_name_user_id_key" ON "labels" (LOWER("name"), "user_id");
