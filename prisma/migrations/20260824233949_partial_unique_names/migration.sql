-- Names must be unique only among ACTIVE rows.
-- Soft-deleted rows (is_active = false) release their names so admins can
-- recreate a category/service with the same name later.

-- Drop the full unique indexes that the initial migration created.
DROP INDEX IF EXISTS "categories_name_key";
DROP INDEX IF EXISTS "services_category_id_name_key";

-- Partial uniques enforced at the DB level.
CREATE UNIQUE INDEX "categories_name_active_uniq"
  ON "categories"("name")
  WHERE "is_active" = true;

CREATE UNIQUE INDEX "services_category_id_name_active_uniq"
  ON "services"("category_id", "name")
  WHERE "is_active" = true;
