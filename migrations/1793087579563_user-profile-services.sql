-- Up Migration
CREATE EXTENSION IF NOT EXISTS citext;
CREATE TYPE user_role AS ENUM ('customer', 'provider');

ALTER TABLE users 
  ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN role user_role NOT NULL DEFAULT 'customer',
  ALTER COLUMN email TYPE citext;

CREATE TABLE provider_profiles (
  id UUID DEFAULT uuidv7() PRIMARY KEY,
  user_id UUID UNIQUE NOT NULL REFERENCES users(id) 
    ON DELETE NO ACTION,
  display_name citext UNIQUE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  city TEXT NOT NULL
);

CREATE TABLE services (
  id UUID DEFAULT uuidv7() PRIMARY KEY, 
  provider_id UUID NOT NULL REFERENCES provider_profiles(id)
    ON DELETE NO ACTION,
  title TEXT NOT NULL,
  price_minor BIGINT NOT NULL CHECK(price_minor >= 0),
  duration_minutes INT NOT NULL CHECK(duration_minutes > 0),
  buffer_before_minutes INT NOT NULL DEFAULT 0 CHECK(buffer_before_minutes >= 0),
  buffer_after_minutes INT NOT NULL DEFAULT 0 CHECK(buffer_after_minutes >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Down Migration
DROP TABLE services;
DROP TABLE provider_profiles;
ALTER TABLE users
  ALTER COLUMN email TYPE text,
  DROP COLUMN role,
  DROP COLUMN updated_at;

DROP TYPE user_role;
