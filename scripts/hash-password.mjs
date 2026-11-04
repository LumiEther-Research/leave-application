// Prints the value for ADMIN_PASSWORD_HASH. Same scrypt format as src/lib/auth/password.ts.
//   printf '%s' 'your password' | node scripts/hash-password.mjs
//   node scripts/hash-password.mjs 'your password'   (stays in shell history)
import { randomBytes, scrypt } from "node:crypto";

const password = process.argv[2] ?? (await new Promise((resolve) => {
  let data = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => (data += chunk));
  process.stdin.on("end", () => resolve(data.replace(/\r?\n$/, "")));
}));

if (!password) {
  console.error("No password given. Pipe it in or pass it as the first argument.");
  process.exit(1);
}

const salt = randomBytes(16);
scrypt(password.normalize("NFKC"), salt, 64, (err, key) => {
  if (err) throw err;
  console.log(`scrypt:${salt.toString("base64url")}:${key.toString("base64url")}`);
});
