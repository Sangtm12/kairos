-- top 10 providers by service count
SELECT
  p.id,
  COUNT(s.id) as service_count
FROM
  provider_profiles p
  JOIN services s ON p.id = s.provider_id
WHERE
  p.deleted_at IS NULL
  AND s.deleted_at IS NULL
GROUP BY
  p.id
ORDER BY
  COUNT(s.id) DESC
LIMIT
  10;

-- each provider's cheapest and most expensive service
(SELECT DISTINCT ON (p.id)
p.id, s.price_minor, s.title, 'low' AS kind
FROM provider_profiles p
JOIN services s
ON p.id = s.provider_id AND s.deleted_at IS NULL
WHERE p.deleted_at IS NULL
ORDER BY p.id, s.price_minor)
UNION ALL
(SELECT DISTINCT ON (p.id)
p.id, s.price_minor, s.title, 'high' AS kind
FROM provider_profiles p
JOIN services s
ON p.id = s.provider_id AND s.deleted_at IS NULL
WHERE p.deleted_at IS NULL
ORDER BY p.id, s.price_minor DESC)
ORDER BY id, price_minor;

--providers with zero services
SELECT p.id 
FROM provider_profiles p 
LEFT JOIN services s ON p.id = s.provider_id
AND s.deleted_at IS NULL
WHERE p.deleted_at IS NULL AND s.id IS NULL;


-- =====================================================================
-- REFERENCE ANSWERS (my queries above are kept as-is)
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Top 10 providers by service count
-- ---------------------------------------------------------------------
-- INNER JOIN on purpose: a provider with 0 services can never be top 10.
-- Soft-delete filter for services sits in ON (same result as WHERE for an
-- INNER JOIN, but keeps the habit consistent with the LEFT JOIN below).
-- display_name is selectable without being in GROUP BY: it's functionally
-- dependent on p.id (the PK), and Postgres knows that.
-- p.id as a tiebreaker makes the cut at #10 deterministic.
SELECT
  p.id,
  p.display_name,
  COUNT(*) AS service_count
FROM provider_profiles p
JOIN services s
  ON s.provider_id = p.id
 AND s.deleted_at IS NULL
WHERE p.deleted_at IS NULL
GROUP BY p.id
ORDER BY service_count DESC, p.id
LIMIT 10;

-- ---------------------------------------------------------------------
-- 2a. Cheapest + most expensive service per provider — window functions
-- ---------------------------------------------------------------------
-- One pass over services instead of two (vs. the UNION ALL version).
-- The window is ordered by price, with s.id as a tiebreaker (24 providers have
-- ties at their min price, and without it the "cheapest" title is random).
-- The explicit frame is REQUIRED: the default frame is "RANGE BETWEEN
-- UNBOUNDED PRECEDING AND CURRENT ROW", so LAST_VALUE would just return the
-- current row. Every row in a partition then holds the same values, and
-- DISTINCT collapses them to one row per provider.
SELECT DISTINCT
  p.id,
  p.display_name,
  FIRST_VALUE(s.title) OVER w AS cheapest_title,
  MIN(s.price_minor)   OVER w AS min_price_minor,
  LAST_VALUE(s.title)  OVER w AS priciest_title,
  MAX(s.price_minor)   OVER w AS max_price_minor
FROM provider_profiles p
JOIN services s
  ON s.provider_id = p.id
 AND s.deleted_at IS NULL
WHERE p.deleted_at IS NULL
WINDOW w AS (
  PARTITION BY p.id
  ORDER BY s.price_minor, s.id
  ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING
)
ORDER BY p.id;

-- ---------------------------------------------------------------------
-- 2b. Same thing with DISTINCT ON — one row per provider (wide format)
-- ---------------------------------------------------------------------
-- DISTINCT ON keeps the FIRST row per p.id according to ORDER BY, so ORDER BY
-- must start with the DISTINCT ON expression. Two CTEs (cheapest, priciest)
-- joined side by side instead of UNION ALL stacking them as rows.
WITH cheapest AS (
  SELECT DISTINCT ON (s.provider_id)
    s.provider_id, s.title, s.price_minor
  FROM services s
  WHERE s.deleted_at IS NULL
  ORDER BY s.provider_id, s.price_minor ASC, s.id
),
priciest AS (
  SELECT DISTINCT ON (s.provider_id)
    s.provider_id, s.title, s.price_minor
  FROM services s
  WHERE s.deleted_at IS NULL
  ORDER BY s.provider_id, s.price_minor DESC, s.id
)
SELECT
  p.id,
  p.display_name,
  c.title       AS cheapest_title,
  c.price_minor AS min_price_minor,
  x.title       AS priciest_title,
  x.price_minor AS max_price_minor
FROM provider_profiles p
JOIN cheapest c ON c.provider_id = p.id
JOIN priciest x ON x.provider_id = p.id
WHERE p.deleted_at IS NULL
ORDER BY p.id;

-- ---------------------------------------------------------------------
-- 3a. Providers with zero services — LEFT JOIN … IS NULL
-- ---------------------------------------------------------------------
-- The services soft-delete filter MUST be in ON, not WHERE. In ON, deleted
-- services never match, so a provider whose services are ALL deleted gets a
-- NULL-extended row and is (correctly) reported. In WHERE, that provider joins
-- to its deleted rows first, then WHERE drops them all, and the provider
-- silently disappears from the result. (Generally: a WHERE condition on the
-- right table that rejects NULLs, e.g. s.price_minor > 0, turns a LEFT JOIN
-- back into an INNER JOIN.)
--
-- Test the JOIN KEY for NULL (s.provider_id), not s.id. Both give 100 rows,
-- but the plans differ (measured on 2k providers / 100k services):
--   WHERE s.id IS NULL          -> Hash Right Join + Filter
--                                   seq-scans all 95k live services, ~22 ms
--   WHERE s.provider_id IS NULL -> Nested Loop Anti Join
--                                   index-only scan per provider, ~2.5 ms
-- Postgres only rewrites an outer join into an anti-join when the IS NULL
-- column is one the join condition is strict on (provider_id = p.id can never
-- be true when provider_id is NULL). It doesn't infer that from s.id's
-- NOT NULL / PK constraint.
SELECT p.id, p.display_name
FROM provider_profiles p
LEFT JOIN services s
  ON s.provider_id = p.id
 AND s.deleted_at IS NULL
WHERE p.deleted_at IS NULL
  AND s.provider_id IS NULL;

-- ---------------------------------------------------------------------
-- 3b. Providers with zero services — NOT EXISTS
-- ---------------------------------------------------------------------
-- States the intent directly: "no live service exists for this provider".
-- Plan: Nested Loop Anti Join -> Index Only Scan on
-- services_provider_id_created_at_not_deleted (partial index, so the
-- deleted_at IS NULL filter is free). It stops at the first matching row per
-- provider (0 heap fetches, ~2.5 ms).
-- Same plan as 3a when 3a is written with s.provider_id IS NULL, so prefer
-- NOT EXISTS: it gets the good plan no matter which column you test.
-- Avoid NOT IN (SELECT provider_id …): if the subquery ever yields a NULL, the
-- whole predicate becomes UNKNOWN and returns zero rows, and it often plans
-- worse.
SELECT p.id, p.display_name
FROM provider_profiles p
WHERE p.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM services s
    WHERE s.provider_id = p.id
      AND s.deleted_at IS NULL
  );

-- Compare plans yourself:
-- EXPLAIN (ANALYZE, BUFFERS) <query>;
