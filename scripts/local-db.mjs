/**
 * Runs a real local Postgres without Docker, for machines where Docker
 * Desktop isn't installed. Same role as `docker compose up -d` in
 * docker-compose.yml — pick whichever one you have available.
 *
 * Usage:
 *   node scripts/local-db.mjs
 *   cp .env.example .env   # DATABASE_URL already matches this instance
 *   npm run db:migrate
 *   npm run db:seed
 */
import EmbeddedPostgres from "embedded-postgres";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const databaseDir = path.join(__dirname, "..", ".local-pg", "data");

const pg = new EmbeddedPostgres({
  databaseDir,
  user: "user",
  password: "password",
  port: 5432,
  persistent: true,
});

async function main() {
  await pg.initialise();
  await pg.start();

  try {
    await pg.createDatabase("ascotworld");
  } catch {
    // Already exists from a previous run — fine.
  }

  console.log("Local Postgres is up: postgresql://user:password@localhost:5432/ascotworld");
  console.log("Leave this running, then in another terminal: npm run db:migrate && npm run db:seed");
}

async function shutdown() {
  await pg.stop();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
