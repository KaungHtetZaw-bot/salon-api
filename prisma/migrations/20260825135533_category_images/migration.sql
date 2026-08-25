-- Categories get hero images for the mobile home screen.
ALTER TABLE "categories" ADD COLUMN "image_url" TEXT;

-- Backfill existing rows so every client sees imagery immediately.
UPDATE "categories" SET "image_url" = CASE "name"
  WHEN 'Hair' THEN 'https://picsum.photos/seed/salon-hair/900/560'
  WHEN 'Nails' THEN 'https://picsum.photos/seed/salon-nails/900/560'
  WHEN 'Spa & Relax' THEN 'https://picsum.photos/seed/salon-spa/900/560'
  ELSE 'https://picsum.photos/seed/salon-default/900/560'
END
WHERE "image_url" IS NULL;
