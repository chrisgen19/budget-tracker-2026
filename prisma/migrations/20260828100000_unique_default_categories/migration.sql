-- Default categories have a NULL user_id, and Postgres treats NULLs as distinct in a unique
-- index, so "categories_name_type_user_id_key" never constrained them: the same default could be
-- inserted twice with no error. The seed's per-category existence check was the only thing
-- standing between that and a duplicate, and a check-then-insert is not atomic.
--
-- A partial unique index covers exactly the default rows and leaves user-owned categories to the
-- existing constraint, which already works for them because their user_id is never NULL.
CREATE UNIQUE INDEX "categories_default_name_type_key"
  ON "categories" ("name", "type")
  WHERE "user_id" IS NULL;
