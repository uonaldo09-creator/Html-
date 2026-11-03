import { defineConfig } from "drizzle-kit";
import * as dotenv from "dotenv";

dotenv.config();

const isCloudSql = !!(process.env.SQL_HOST && process.env.SQL_ADMIN_USER);

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  schemaFilter: ["public"],
  dbCredentials: isCloudSql ? {
    host: process.env.SQL_HOST!,
    user: process.env.SQL_ADMIN_USER,
    password: process.env.SQL_ADMIN_PASSWORD,
    database: process.env.SQL_DB_NAME!,
    ssl: false,
  } : {
    url: process.env.DATABASE_URL || "postgresql://postgres:postgres@localhost:5432/postgres",
  },
  verbose: true,
});
