-- Runs once, on first database creation. The application also ensures these at
-- boot (see knowledge/searchSetup.js) so a managed Postgres without an init
-- hook still works; this just gets it right from the start locally.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;
