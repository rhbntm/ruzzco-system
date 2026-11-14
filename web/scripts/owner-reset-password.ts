/**
 * Recovery when the owner forgets the password (slice 19, Decision 14). Run on the shop PC:
 *
 *   npm run owner:reset-password
 *
 * Needs the database (DATABASE_URL in web/.env). Asks for the owner account's username and a new
 * password on the terminal (typed hidden, never an argument, never printed), sets it, and
 * reactivates the account if it was deactivated. Every session of that account ends. Physical
 * access to the PC is the recovery credential.
 */
import { createInterface } from "node:readline";
import { loadEnvConfig } from "@next/env";
import { prisma } from "../src/lib/prisma";
import { hashPassword, normalizeUsername, passwordProblem } from "../src/lib/passwords";

loadEnvConfig(process.cwd());

function ask(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (answer) => { rl.close(); resolve(answer); }));
}

// Reads a line without echoing it.
function askHidden(question: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    if (!stdin.isTTY) {
      reject(new Error("Run this in a terminal: the password is typed, never piped or passed as an argument."));
      return;
    }
    process.stdout.write(question);
    let value = "";
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    const onData = (chunk: string) => {
      for (const char of chunk) {
        if (char === "\r" || char === "\n") {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off("data", onData);
          process.stdout.write("\n");
          resolve(value);
          return;
        }
        if (char === "\u0003") { // Ctrl+C
          stdin.setRawMode(false);
          process.stdout.write("\n");
          process.exit(130);
        }
        if (char === "\u007f" || char === "\b") value = value.slice(0, -1);
        else value += char;
      }
    };
    stdin.on("data", onData);
  });
}

async function main() {
  const owners = await prisma.user.findMany({
    where: { role: "OWNER", username: { not: null } },
    select: { username: true, isActive: true },
    orderBy: { username: "asc" },
  });
  if (owners.length === 0) {
    console.log("No owner account has a username yet. Open an owner page, unlock it with the owner PIN, and create one on Staff accounts.");
    return;
  }
  console.log("Owner accounts:");
  for (const owner of owners) console.log(`  - ${owner.username}${owner.isActive ? "" : " (deactivated)"}`);

  const username = normalizeUsername(await ask("Username: "));
  const account = username ? await prisma.user.findUnique({ where: { username }, select: { id: true, role: true, isActive: true } }) : null;
  if (!account || account.role !== "OWNER") {
    console.log("No owner account with that username. Nothing changed.");
    process.exitCode = 1;
    return;
  }

  const password = await askHidden("New password: ");
  const problem = passwordProblem(password);
  if (problem) {
    console.log(`${problem} Nothing changed.`);
    process.exitCode = 1;
    return;
  }
  if ((await askHidden("Type it again: ")) !== password) {
    console.log("The two passwords differ. Nothing changed.");
    process.exitCode = 1;
    return;
  }

  await prisma.user.update({
    where: { id: account.id },
    data: { passwordHash: await hashPassword(password), passwordChangedAt: new Date(), isActive: true },
  });
  console.log(`Password set for ${username}.${account.isActive ? "" : " The account was deactivated; it is active again."} Every session of this account has ended.`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
