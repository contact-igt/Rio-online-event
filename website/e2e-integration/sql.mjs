// Runs ONE statement against the throw-away MariaDB named by RIO_E2E_MYSQL_URL and prints the resulting rows as JSON (an empty list for a write).
// The spec calls it only when that variable is set, to prove what the API stored; the default run reads a disposable SQLite file instead.
import mysql from "../../backend/node_modules/mysql2/promise.js";

const [sql, params = "[]"] = process.argv.slice(2);
const connection = await mysql.createConnection(process.env.RIO_E2E_MYSQL_URL);
try {
  const [result] = await connection.query(sql, JSON.parse(params));
  process.stdout.write(JSON.stringify(Array.isArray(result) ? result : []));
} finally {
  await connection.end();
}
