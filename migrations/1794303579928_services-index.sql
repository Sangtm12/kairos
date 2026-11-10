-- Up Migration
CREATE INDEX services_provider_id_created_at_not_deleted
  ON services (provider_id, created_at)
  WHERE deleted_at IS NULL;

CREATE INDEX services_created_at_not_deleted
  ON services (created_at)
  WHERE deleted_at IS NULL;
-- Down Migration
DROP INDEX services_created_at_not_deleted;
DROP INDEX services_provider_id_created_at_not_deleted;
