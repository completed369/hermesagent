\set ON_ERROR_STOP on

SELECT current_user = 'ventureos_bootstrap' AS is_bootstrap \gset
\if :is_bootstrap
\else
  \echo '10-roles.sql must run as ventureos_bootstrap'
  \quit 1
\endif

SELECT 'CREATE ROLE ventureos_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION'
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ventureos_owner') \gexec
SELECT 'CREATE ROLE ventureos_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION CONNECTION LIMIT 20'
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ventureos_app') \gexec
SELECT 'CREATE ROLE ventureos_migrator LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION CONNECTION LIMIT 3'
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ventureos_migrator') \gexec
SELECT 'CREATE ROLE ventureos_temporal LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION CONNECTION LIMIT 30'
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ventureos_temporal') \gexec
SELECT 'CREATE ROLE ventureos_backup LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION CONNECTION LIMIT 2'
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ventureos_backup') \gexec

SELECT format('ALTER ROLE ventureos_app PASSWORD %L', :'app_password') \gexec
SELECT format('ALTER ROLE ventureos_migrator PASSWORD %L', :'migrator_password') \gexec
SELECT format('ALTER ROLE ventureos_temporal PASSWORD %L', :'temporal_password') \gexec
SELECT format('ALTER ROLE ventureos_backup PASSWORD %L', :'backup_password') \gexec

GRANT ventureos_owner TO ventureos_migrator;

SELECT 'CREATE DATABASE ventureos OWNER ventureos_owner'
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'ventureos') \gexec
SELECT 'CREATE DATABASE temporal OWNER ventureos_temporal'
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'temporal') \gexec
SELECT 'CREATE DATABASE temporal_visibility OWNER ventureos_temporal'
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'temporal_visibility') \gexec

REVOKE CONNECT ON DATABASE ventureos FROM PUBLIC;
REVOKE CONNECT ON DATABASE temporal FROM PUBLIC;
REVOKE CONNECT ON DATABASE temporal_visibility FROM PUBLIC;
GRANT CONNECT ON DATABASE temporal, temporal_visibility TO ventureos_temporal;
