# Contributing to Ruzzco Barbers System

How to fork this repository, run it on your own machine, and send changes back as a pull request. Written for the capstone team; no prior knowledge of the code is assumed.

Maintainer: Brent (`rhbntm`). Ask before starting anything big, so we do not build the same thing twice.

If you use Claude Code, jump to **Start here**: it can do most of the setup with you.

## Start here (if you use Claude Code)

You do not have to memorise this guide. Open Claude Code in the folder where you want the project, and paste this:

> Read CONTRIBUTING.md in https://github.com/rhbntm/ruzzco-system, especially the section "For Claude". I am a groupmate, not the owner of the repo. Help me fork it, set it up on my computer, and make my first change. Explain each step in plain words and ask me before anything that could delete or overwrite things.

(If you have not forked yet, ask Claude to do step 2 first. Claude can run the commands for you.)

## For Claude (read this before helping the user)

The person you are helping is a **contributor on a fork**, not the repository owner. They may not be technical. Follow these rules:

**Who is who**

- `CLAUDE.md` and `docs/slices/` were written for the repo owner, Brent. In `CLAUDE.md`, "I", "me" and "my" mean Brent. Use it as the source of the project's rules (business facts, invariants, commands), but **skip owner-only habits**: do not log to `docs/sessions/`, do not do the "Wrap up" or "run slice N" routines, and ignore `../ruzzco-barbers` (a private notes repo the contributor does not have).
- The contributor decides what to build. Do not start big features, or change the locked business facts, without them agreeing it was discussed with Brent.

**How to talk to them**

- Plain language. No jargon without a one-line explanation (for example: "a branch is your own copy of the code where you can try changes safely").
- One step at a time. After each step, say what happened and what comes next.
- Run the commands yourself where you can, and show them what you ran. Ask first before anything that deletes, overwrites, or cannot be undone (`git reset --hard`, `git push --force`, `docker compose down -v`, deleting files).
- If something fails, show the error in simple words, try one fix, and if it still fails, stop and ask. Do not loop.

**Safety (always)**

- Never print, log, or commit `.env` files or their values (passwords, `OWNER_PIN`, API keys). If you must check a setting exists, check only that the name is present.
- Never commit client data: the logbook workbook, `ml-service/data/`, `ml-service/artifacts/`, `backups/`, or real sales figures (also not in tests, docs or commit messages).
- Never run `prisma db push`, `prisma migrate dev` or `prisma migrate reset`.
- Work on a branch, never directly on `main`. Commit only when the contributor asks. Never push, or force-push, without their explicit OK. Do not add `Co-Authored-By` lines.
- **GitHub login problems:** follow section 2.1. Recommend **HTTPS** to anyone who is unsure or struggling with SSH; it avoids keys completely. Run `git remote -v` and `ssh -T git@github.com` to see what is happening before changing anything. `Permission denied (publickey)` is fixed on the GitHub website (adding the public key) or in their `.ssh` folder; walk them through it.
- **SSH keys:** only ever open, print or paste the **public** key (`.pub`). Never read, print, copy or commit a private key (a file without `.pub`, such as `id_ed25519`), and never ask the user to paste one. You cannot add a key to their GitHub account; the user does that on github.com. Do not edit `~/.ssh/config` without telling them what you are adding and why.
- Push to `origin` (their fork). Never push to `upstream` (Brent's repo); they do not have permission, and a pull request is how changes get there.

**Checklist to walk them through** (tick each off with them; details are in the sections below)

1. Check the tools exist: `git --version`, `node --version`, `docker --version`. If one is missing, tell them what to install and wait.
2. Fork the repo on GitHub (they click Fork; you cannot do it for them), check `git config user.name` and `user.email`, settle HTTPS vs SSH (section 2.1; default to HTTPS), then clone **their fork** and add `upstream` (section 2).
3. Make sure Docker Desktop is running, then set up the two `.env` files from the `.env.example` files with passwords the contributor chooses, start MySQL, `npm install`, `prisma migrate deploy`, `prisma db seed`, `npm run dev` (section 3). Open http://localhost:3000 together and confirm the home page loads.
4. Ask what they want to change. If it is not small and clear, suggest they message Brent first.
5. Create a branch, make the change, and keep it small (section 4).
6. Run `npm run lint`, `npx tsc --noEmit`, and the matching tests from the table in section 5. Report results honestly, including failures.
7. For screen changes, ask the contributor to look at the page in their browser and confirm it, since you cannot always see it.
8. When they are happy: commit, push the branch to their fork, and help them open the pull request on GitHub using the template in section 6.

## 1. What you need installed

- **Git** and a GitHub account.
- **Node.js** (current LTS) and npm, for `web/`.
- **Docker Desktop**, for the MySQL database and the forecasting service.
- A code editor (VS Code is fine).
- Python is **not** needed on your machine; the forecasting service runs in Docker.

## 2. Fork and clone

1. On GitHub, open `rhbntm/ruzzco-system` and click **Fork**. This makes your own copy under your account.
2. Decide how your computer will log in to GitHub (section 2.1 below). **If you have never set up an SSH key, use HTTPS**: it needs no key and is the easiest.
3. Tell Git who you are (once per computer; use the email on your GitHub account):

   ```bash
   git config --global user.name "Your Name"
   git config --global user.email "you@example.com"
   ```

4. Clone **your fork** (not Brent's). HTTPS version:

   ```bash
   git clone https://github.com/<your-username>/ruzzco-system.git
   cd ruzzco-system
   ```

   SSH version (only if section 2.1 says your SSH test passed): `git clone git@github.com:<your-username>/ruzzco-system.git`
5. Add Brent's repo as `upstream` (same style, HTTPS or SSH, as the clone), so you can pull in his latest changes:

   ```bash
   git remote add upstream https://github.com/rhbntm/ruzzco-system.git
   git remote -v        # origin = your fork, upstream = Brent's repo
   ```

### 2.1 Logging in to GitHub: HTTPS or SSH

Pick **one**. You do not need both.

#### Option A: HTTPS (recommended if you are unsure)

- Use `https://github.com/...` URLs, as above.
- The first time you `git push`, a browser window should open asking you to sign in to GitHub (this comes with Git for Windows and recent Git for Mac). Sign in and approve. It remembers you afterwards.
- GitHub no longer accepts your account password on the command line. If a terminal asks for a "password", it wants a **personal access token** instead: GitHub, Settings, Developer settings, Personal access tokens, create one that can read and write repository contents, and paste it as the password. Treat it like a password and never put it in a file in the project.

#### Option B: SSH key

1. **Test first.** Run:

   ```bash
   ssh -T git@github.com
   ```

   - `Hi <your-username>! You've successfully authenticated, but GitHub does not provide shell access.` means SSH already works. Skip to the clone step.
   - `Are you sure you want to continue connecting (yes/no)?` is normal the first time. Type `yes`.
   - `Permission denied (publickey)` means GitHub does not know your key. Continue below.
2. **Create a key** (press Enter to accept the default location; a passphrase is optional):

   ```bash
   ssh-keygen -t ed25519 -C "you@example.com"
   ```

   This makes two files in your `.ssh` folder: `id_ed25519` (the **private** key, secret, never share it) and `id_ed25519.pub` (the **public** key, safe to share).
3. **Show the public key** and copy all of it (one line starting with `ssh-ed25519`):

   ```bash
   cat ~/.ssh/id_ed25519.pub                          # Git Bash, Mac, Linux
   Get-Content $env:USERPROFILE\.ssh\id_ed25519.pub   # Windows PowerShell
   ```

4. **Add it to GitHub:** github.com, your profile picture, Settings, SSH and GPG keys, New SSH key, paste, Save. Use the **same GitHub account** that owns your fork.
5. **Load the key into the SSH agent** so it is used automatically:
   - Windows PowerShell (opened as Administrator, once):

     ```powershell
     Get-Service ssh-agent | Set-Service -StartupType Automatic
     Start-Service ssh-agent
     ```

     then, in a normal window: `ssh-add $env:USERPROFILE\.ssh\id_ed25519`
   - Mac: `ssh-add --apple-use-keychain ~/.ssh/id_ed25519`
   - Linux or Git Bash: `eval "$(ssh-agent -s)"` then `ssh-add ~/.ssh/id_ed25519`
6. Run `ssh -T git@github.com` again. You want the "successfully authenticated" message.

#### If SSH still fails

| What you see | Likely cause and fix |
| --- | --- |
| `Permission denied (publickey)` | The public key is not on your GitHub account, or it is on a different account. Re-check step 4. Run `ssh -T -v git@github.com` and look for "Offering public key" lines to see which key is used. |
| `Host key verification failed` | Your `known_hosts` entry is wrong. Delete the `github.com` line from `~/.ssh/known_hosts` and reconnect, answering `yes`. |
| Hangs, `Connection timed out` or `Connection refused` on port 22 | A school or office network is blocking SSH. Use SSH over port 443 (config below), or just switch to HTTPS (Option A). |
| You have several keys (school, work, another GitHub account) and the wrong one is used | In `~/.ssh/config`, under `Host github.com`, add `IdentityFile ~/.ssh/id_ed25519` and `IdentitiesOnly yes`. |
| `Enter passphrase for key` every time | Load the key into the agent (step 5). |
| `Repository not found` | The URL is wrong, or you are signed in to a different GitHub account, or you cloned Brent's repo instead of your fork. Check `git remote -v`. |
| `Please tell me who you are` when committing | Run the two `git config --global` commands from step 3. |

SSH over port 443, for `~/.ssh/config` (create the file if it does not exist):

```
Host github.com
  Hostname ssh.github.com
  Port 443
  User git
```

#### Switching between HTTPS and SSH later

You can change how an existing clone connects without cloning again:

```bash
git remote set-url origin https://github.com/<your-username>/ruzzco-system.git   # to HTTPS
git remote set-url origin git@github.com:<your-username>/ruzzco-system.git       # to SSH
```

## 3. Run the project locally

The full steps are in `README.md`. The short version:

```bash
# repo root
cp .env.example .env              # choose your OWN MySQL passwords; never commit this file
docker compose up -d mysql

cd web
cp .env.example .env              # DATABASE_URL must use the same user and password, port 3307
npm install
npx prisma migrate deploy         # create the tables
npx prisma db seed                # barbers and services
npm run dev                       # http://localhost:3000
```

Notes:

- Set `OWNER_PIN` in `web/.env` to any PIN you like. It is only for your machine. It unlocks the owner-only pages (`/ledger`, `/forecast`, `/payment-qr`).
- Leave the payment gateway settings (`PAYMENT_GATEWAY`, `PAYMONGO_*`) off unless you are working on QR Ph. Never paste real keys anywhere that is committed.
- `npm run seed:demo` loads placeholder demo data so the screens are not empty.
- On Windows, `scripts/dev-reset.ps1` frees port 3000, starts the database container and runs `prisma generate`. Run it if `prisma generate` fails with an EPERM error (a running dev server locks the Prisma engine).
- The **forecast** needs the client's paper logbook workbook, which is private and is not in the repository. Without it the forecast panel simply shows no forecast; everything else works. Do not ask for it in a public place, and never commit it (`ml-service/data/` and `ml-service/artifacts/` are git-ignored on purpose).

## 4. Making a change

1. Sync with Brent's latest `main` before you start:

   ```bash
   git checkout main
   git fetch upstream
   git merge upstream/main          # or: git rebase upstream/main
   git push origin main
   ```

2. Create a branch for **one task**:

   ```bash
   git checkout -b feat/short-description     # or fix/..., docs/..., test/...
   ```

3. Make the change. Keep it small and focused; one task per branch and one branch per pull request.
4. Commit with a short message in the style of the history, for example `feat(ledger): ...`, `fix(sync): ...`, `docs: ...`, `test: ...`:

   ```bash
   git add <the files you changed>
   git commit -m "fix(pos): ..."
   git push -u origin feat/short-description
   ```

5. On GitHub, open a **Pull Request** from your branch into `rhbntm/ruzzco-system` `main`.

## 5. Before you open the pull request

Run these from `web/` and fix anything they report:

```bash
npm run lint
npx tsc --noEmit
```

Then run the test suites that match what you touched (all are `npm run test:<name>`; the ones marked "dev server" need `npm run dev` running in another terminal):

| You changed                 | Run                                                                                               |
| --------------------------- | ------------------------------------------------------------------------------------------------- |
| Sales, sync, offline queue  | `test:sync-rejections` (dev server), `test:sync-queue`, `test:payload-compat`, `test:submit-lock` |
| Commission, payouts, ledger | `test:commission`, `test:ledger-summary` (dev server)                                             |
| End-of-day cash             | `test:reconciliation` (dev server)                                                                |
| Prices, discounts           | `test:pricing`                                                                                    |
| Owner PIN                   | `test:pin-attempts` (`test:owner-unlock` is rate limited: at most 5 runs per 15 minutes)          |
| Forecast screens            | `test:forecast-parse`, `test:forecast-comparison`                                                 |
| Payment QR                  | `test:payment-qr` (dev server), `test:qr-cache`                                                   |

If you are unsure, run them all that work without extra setup. `test:gateway` and `test:attribution` need extra environment settings; ask Brent before relying on them.

For UI changes, reload the page in your browser and check it yourself. In the pull request, say what you checked and what you could not check.

## 6. What to put in the pull request

Copy this into the pull request description and fill it in:

```
## What changed and why

## How I checked it
(commands run and results; what I looked at in the browser)

## Screenshots

## Questions / not sure about
```

It should contain:

- **What** changed and **why**, in two or three sentences.
- The commands you ran and whether they passed.
- Screenshots for any screen change.
- Anything you are unsure about. A question is better than a guess.

Brent reviews and merges. If he asks for changes, push more commits to the same branch; the pull request updates by itself.

## 7. Rules that protect the project

These come from decisions already made with the client. Please do not change them without talking to Brent first.

- **Business facts are fixed.** Haircut is a fixed ₱200, Shave & Massage ₱150, commission is 50/50, tips go 100% to the barber, there are no PWD or student discounts, the shop is open 10 AM to 10 PM daily. Full list in `CLAUDE.md`, "Business facts".
- **Business dates are Asia/Manila (UTC+8).** Never derive a date from UTC defaults. Use the helpers in `web/src/lib/business-date.ts`.
- **Money is `Decimal(10,2)`.** No floating-point arithmetic on amounts. Commissions are saved when the sale is made and never recomputed from current rates.
- **Offline first.** The POS writes to the phone first (Dexie), then syncs. A sale's id is its idempotency key. New fields on a sale must be optional or have defaults, so old queued sales still work. Use `generateUUID()` from `web/src/lib/db.ts`, not `crypto.randomUUID()`.
- **Never rewrite a sale after the fact** (barber, device assignment, amount, payment).
- **Database changes** are additive and committed as migrations in `web/prisma/migrations/`. Never run `prisma db push`, `prisma migrate dev` or `prisma migrate reset`. The README explains how to write and apply a migration.
- **Owner-only pages stay owner-only.** Do not expose forecast, ledger, payout or payment-QR data without the owner PIN check.
- **No client data or secrets in the repository.** Never commit `.env` files, passwords, API keys, the logbook, model files, database backups, or real sales figures (in code, tests, screenshots, docs or commit messages). Use invented numbers in tests. Specs under `docs/slices/` are public on GitHub; keep personal details out of them.
- **The forecast** is built only in `ml-service/`. It never reads or writes sales, and it does not use haircut type or payment method as features.

## 8. Where things are

- `web/`: the Next.js app (POS, shift log, end-of-day cash, ledger, forecast screens, API routes under `web/src/app/api/v1/`). Shared logic is in `web/src/lib/`. Tests are in `web/scripts/`.
- `web/prisma/`: the database schema and migrations.
- `ml-service/`: the Python forecasting service and its tests.
- `docs/slices/`: one spec per piece of work (`slice-N.md`). Read the latest ones to see how a feature was planned.
- `CLAUDE.md`: the full project rules and commands. It is written for the AI coding assistant Brent uses, but it is also the best summary of the rules above.

## 9. Getting unstuck

- Port 3000 or 3307 already in use: stop the other program, or change the port mapping.
- Database will not start or the password is rejected: MySQL reads the passwords only when its volume is first created. Changing `.env` later does nothing to an existing database; recreate the volume with `docker compose down -v` (this erases your **local** data only), then start it again.
- `prisma generate` fails with EPERM on Windows: stop the dev server first.
- Cannot clone or push (`Permission denied (publickey)`, `Repository not found`, a password prompt): see section 2.1.
- Anything else: open a draft pull request or message Brent with the exact error text (without any passwords).
