\set ON_ERROR_STOP on
\getenv migrator_password HR_ERP_MIGRATOR_PASSWORD
\getenv app_password HR_ERP_APP_PASSWORD

SELECT format('CREATE ROLE hr_erp_migrator LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT PASSWORD %L', :'migrator_password')
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'hr_erp_migrator') \gexec
SELECT format('ALTER ROLE hr_erp_migrator LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT PASSWORD %L', :'migrator_password') \gexec

SELECT format('CREATE ROLE hr_erp_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT PASSWORD %L', :'app_password')
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'hr_erp_app') \gexec
SELECT format('ALTER ROLE hr_erp_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT PASSWORD %L', :'app_password') \gexec

ALTER DATABASE hr_erp OWNER TO hr_erp_migrator;
REVOKE ALL ON DATABASE hr_erp FROM PUBLIC;
GRANT CONNECT, TEMPORARY ON DATABASE hr_erp TO hr_erp_migrator;
GRANT CONNECT ON DATABASE hr_erp TO hr_erp_app;

ALTER SCHEMA public OWNER TO hr_erp_migrator;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT ALL ON SCHEMA public TO hr_erp_migrator;
GRANT USAGE ON SCHEMA public TO hr_erp_app;

SELECT format('ALTER TABLE %I.%I OWNER TO hr_erp_migrator', n.nspname, c.relname)
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') \gexec

SELECT format('ALTER SEQUENCE %I.%I OWNER TO hr_erp_migrator', n.nspname, c.relname)
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'S' \gexec

SELECT format('ALTER %s %I.%I OWNER TO hr_erp_migrator',
  CASE c.relkind WHEN 'm' THEN 'MATERIALIZED VIEW' ELSE 'VIEW' END, n.nspname, c.relname)
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind IN ('v', 'm') \gexec

SELECT format('ALTER TYPE %I.%I OWNER TO hr_erp_migrator', n.nspname, t.typname)
FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
WHERE n.nspname = 'public' AND t.typtype IN ('d', 'e') \gexec

SELECT format('ALTER %s %I.%I(%s) OWNER TO hr_erp_migrator',
  CASE p.prokind WHEN 'p' THEN 'PROCEDURE' ELSE 'FUNCTION' END,
  n.nspname, p.proname, pg_get_function_identity_arguments(p.oid))
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.prokind IN ('f', 'p') \gexec

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM hr_erp_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO hr_erp_app;
SELECT format('REVOKE ALL ON TABLE %I.%I FROM hr_erp_app', n.nspname, c.relname)
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relname = '_prisma_migrations' AND c.relkind IN ('r', 'p') \gexec
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM hr_erp_app;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO hr_erp_app;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC, hr_erp_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO hr_erp_app;

ALTER DEFAULT PRIVILEGES FOR ROLE hr_erp_migrator IN SCHEMA public REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE hr_erp_migrator IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO hr_erp_app;
ALTER DEFAULT PRIVILEGES FOR ROLE hr_erp_migrator IN SCHEMA public REVOKE ALL ON SEQUENCES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE hr_erp_migrator IN SCHEMA public GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO hr_erp_app;
ALTER DEFAULT PRIVILEGES FOR ROLE hr_erp_migrator IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE hr_erp_migrator IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO hr_erp_app;

DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname IN ('hr_erp_migrator', 'hr_erp_app') AND (rolsuper OR rolcreatedb OR rolcreaterole)) THEN
    RAISE EXCEPTION 'ERP database roles have forbidden administrative privileges';
  END IF;
  IF has_schema_privilege('hr_erp_app', 'public', 'CREATE') THEN
    RAISE EXCEPTION 'hr_erp_app must not create schema objects';
  END IF;
END $$;
