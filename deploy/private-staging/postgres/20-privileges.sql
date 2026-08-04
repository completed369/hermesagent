\set ON_ERROR_STOP on
\connect ventureos

REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON SCHEMA public FROM ventureos_app, ventureos_backup;
GRANT CONNECT ON DATABASE ventureos TO ventureos_app;
GRANT CONNECT ON DATABASE ventureos TO ventureos_migrator;
GRANT CONNECT ON DATABASE ventureos TO ventureos_backup;
GRANT USAGE ON SCHEMA public TO ventureos_app, ventureos_backup;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ventureos_app;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO ventureos_app;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO ventureos_backup;
GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO ventureos_backup;

ALTER DEFAULT PRIVILEGES FOR ROLE ventureos_owner IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ventureos_app;
ALTER DEFAULT PRIVILEGES FOR ROLE ventureos_owner IN SCHEMA public
  GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO ventureos_app;
ALTER DEFAULT PRIVILEGES FOR ROLE ventureos_owner IN SCHEMA public
  GRANT SELECT ON TABLES TO ventureos_backup;
ALTER DEFAULT PRIVILEGES FOR ROLE ventureos_owner IN SCHEMA public
  GRANT SELECT ON SEQUENCES TO ventureos_backup;
