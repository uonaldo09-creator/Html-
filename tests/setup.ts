process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "postgres://uniinfo_test:uniinfo_test@127.0.0.1:1/uniinfo_test";
delete process.env.SUPABASE_DB_URL;
