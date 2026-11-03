import { defineConfig } from "drizzle-kit";
import * as dotenv from "dotenv";

dotenv.config();

const sqlHost = process.env.SQL_HOST;
const sqlUser = process.env.SQL_ADMIN_USER;
const sqlPassword = process.env.SQL_ADMIN_PASSWORD;
const sqlDatabase = process.env.SQL_DB_NAME;
const isCloudSql = !!(sqlHost && sqlUser && sqlPassword && sqlDatabase);

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  schemaFilter: ["public"],
  dbCredentials: isCloudSql ? {
    host: sqlHost!,
    user: sqlUser!,
    password: sqlPassword!,
    database: sqlDatabase!,
    ssl: false,
  } : {
    url: process.env.DATABASE_URL || "postgresql://postgres:postgres@localhost:5432/postgres",
  },
  verbose: true,
});
