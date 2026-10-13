import { execSync } from "child_process";

/** Points tests at <db>_test and rebuilds its tables. Refuses to touch any database not named *_test. */
export default function setup() {
  const url = new URL(process.env.DATABASE_URL!);
  const base = url.pathname.slice(1);
  const testDb = base.endsWith("_test") ? base : `${base}_test`;
  url.pathname = `/${testDb}`;
  if (!testDb.endsWith("_test")) throw new Error("Refusing to reset a non-test database");
  process.env.DATABASE_URL = url.toString();
  execSync("npx prisma db push --skip-generate --force-reset --accept-data-loss", { env: process.env, stdio: "inherit" });
}
