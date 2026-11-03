0004_review_user_uniqueness
--
-- Establish one review per (university_id, normalized user_email).
-- Duplicate rows are archived before deletion. This migration deliberately
-- aborts if duplicate logical reviews have different review content; those
-- conflicts require a human decision instead of silently discarding a review.
--
-- REQUIRED: create and verify a fresh database backup before applying.
-- Apply to an isolated rehearsal database first:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -1 -f drizzle/0004_review_user_uniqueness.sql
--
-- The archived copies remain in public.reviews_dedup_archive for audit/recovery.
-- This migration does not merge or delete university records.

DO $$
DECLARE
  conflicting_groups bigint;
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.reviews
    WHERE NULLIF(BTRIM(user_email), '') IS NULL
  ) THEN
    RAISE EXCEPTION
      'Review uniqueness migration stopped: one or more reviews have an empty user_email.';
  END IF;

  SELECT COUNT(*)
  INTO conflicting_groups
  FROM (
    SELECT university_id, LOWER(BTRIM(user_email)) AS normalized_email
    FROM public.reviews
    GROUP BY university_id, LOWER(BTRIM(user_email))
    HAVING COUNT(*) > 1
       AND COUNT(DISTINCT JSONB_BUILD_ARRAY(
         user_name,
         rating,
         comment,
         avatar,
         review_date
       )) > 1
  ) AS conflicts;

  IF conflicting_groups > 0 THEN
    RAISE EXCEPTION
      'Review uniqueness migration stopped: % duplicate user/university groups contain different review content. Resolve them manually first.',
      conflicting_groups;
  END IF;
END
$$;

-- Keep an exact copy of every row that is about to be removed. The archive
-- table is intentionally outside the Drizzle application schema.
CREATE TABLE IF NOT EXISTS public.reviews_dedup_archive
  (LIKE public.reviews INCLUDING ALL);

ALTER TABLE public.reviews_dedup_archive
  ADD COLUMN IF NOT EXISTS archived_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE public.reviews_dedup_archive
  ADD COLUMN IF NOT EXISTS archive_reason text NOT NULL
  DEFAULT 'Repeated identical review for the same university and reviewer';

-- Archive all but the oldest row in each normalized user/university group.
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY university_id, LOWER(BTRIM(user_email))
      ORDER BY created_at ASC, id ASC
    ) AS rn
  FROM public.reviews
)
INSERT INTO public.reviews_dedup_archive (
  id,
  university_id,
  user_email,
  user_name,
  rating,
  comment,
  avatar,
  review_date,
  created_at,
  archived_at,
  archive_reason
)
SELECT
  r.id,
  r.university_id,
  r.user_email,
  r.user_name,
  r.rating,
  r.comment,
  r.avatar,
  r.review_date,
  r.created_at,
  now(),
  'Repeated identical review for the same university and reviewer'
FROM public.reviews AS r
JOIN ranked AS d ON d.id = r.id
WHERE d.rn > 1
ON CONFLICT (id) DO NOTHING;

-- Remove only rows that have been archived above. The earliest original row
-- (created_at, then id) remains the canonical review.
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY university_id, LOWER(BTRIM(user_email))
      ORDER BY created_at ASC, id ASC
    ) AS rn
  FROM public.reviews
)
DELETE FROM public.reviews AS r
USING ranked AS d
WHERE r.id = d.id
  AND d.rn > 1;

-- Normalize remaining email keys before creating the unique index.
UPDATE public.reviews
SET user_email = LOWER(BTRIM(user_email))
WHERE user_email IS DISTINCT FROM LOWER(BTRIM(user_email));

CREATE UNIQUE INDEX IF NOT EXISTS reviews_university_user_unique_idx
  ON public.reviews (university_id, user_email);

-- Recompute review aggregates from the surviving review rows.
INSERT INTO public.university_reviews_agg (
  university_id,
  avg_rating,
  review_count
)
SELECT
  university_id,
  ROUND(AVG(rating)::numeric, 2)::double precision,
  COUNT(*)::integer
FROM public.reviews
GROUP BY university_id
ON CONFLICT (university_id) DO UPDATE
SET
  avg_rating = EXCLUDED.avg_rating,
  review_count = EXCLUDED.review_count;

UPDATE public.university_reviews_agg AS agg
SET
  avg_rating = 0,
  review_count = 0
WHERE NOT EXISTS (
  SELECT 1
  FROM public.reviews AS review
  WHERE review.university_id = agg.university_id
);

-- Keep the SERIAL sequence ahead of existing review IDs. Older application
-- code inserted explicit IDs, which does not advance the sequence.
SELECT setval(
  pg_get_serial_sequence('public.reviews', 'id'),
  COALESCE(MAX(id), 1),
  MAX(id) IS NOT NULL
)
FROM public.reviews;

-- Rollback guidance:
--   Do not automatically reinsert archive rows after the application begins
--   accepting new reviews; doing so can violate the new uniqueness rule.
--   For full rollback, restore the pre-migration backup. Archived copies are
--   retained for audit and selective manual recovery.  
