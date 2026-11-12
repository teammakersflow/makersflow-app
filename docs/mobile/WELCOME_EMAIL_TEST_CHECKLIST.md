# Welcome email: manual test checklist

- **Prepared:** 2026-11-12.
- **Scope:** testing only. **No app code was changed for this**, and no account was created and no email was sent while preparing it.

## What the app does (inspected)

| Flow | App call | Duplicate-submit protection | Who sends the email |
|---|---|---|---|
| Email + password sign-up | `app/(auth)/register.tsx` → `register()` → `POST /auth/register` | Button disabled while `loading` | Backend, after the user row is created (`makersflow-backend` `main`, commit `7e9b038` "send welcome email on account creation"; fire-and-forget) |
| Google sign-in (login or register screen) | `POST /auth/google` | `if (googleLoading) return;` plus a disabled button | Backend, only when `googleLogin` **creates** a new user |
| Login (email or Google, existing user) | `POST /auth/login` / `POST /auth/google` | n/a | Should send nothing |

**App-side assessment:** no app bug found that could send a second welcome email.
- **Email + password:** the register handler has no ref guard, so in theory a very fast double tap could fire two requests before the button disables. The second one would fail on the existing email (unique), so there is still one account and one email. It is listed as a test below; no code change was made.
- **Backend dependency:** the welcome email is on `makersflow-backend` **`main`**. The local backend copy (`staging/integration-2026-11-11`) does not contain commit `7e9b038`. Test against an environment where `main` is deployed.

## Rules for the tester

- Use **controlled test mailboxes you own**, e.g. plus-addresses such as `qa+welcome1@<your-domain>`, and a dedicated Google test account. Never use real customer addresses.
- Test against **staging / test** first. If production is the only option, create the **minimum** number of accounts (one per row below), and delete them afterwards via Profile → Delete Account.
- Do not open the store checkout and do not start any payment.
- Record the mailbox, time, app build and result for each step. Check the spam folder as well before calling an email "not received".
- Wait about 2 minutes after each action before checking (sending is asynchronous).

## Checklist

| # | Step | Expected | Result |
|---|---|---|---|
| 1 | Install the test build; register a **new** email/password account (mailbox A) | Account created; **exactly one** "Welcome to MakersFlow…" email in mailbox A | |
| 2 | Log out; log in again with mailbox A | Login works; **no** new welcome email | |
| 3 | Kill and reopen the app (session restore) | **No** new welcome email | |
| 4 | Log out; on the register screen, try to register mailbox A again | Error such as "email already exists"; **no** new welcome email | |
| 5 | Register a new account (mailbox B), tapping **Create account** twice quickly | One account; **exactly one** welcome email in mailbox B (a second request, if any, is rejected) | |
| 6 | Log out; **Continue with Google** using a Google test account that has **never** used MakersFlow (Google account G) | Signed in; **exactly one** welcome email to G's address | |
| 7 | Log out; Continue with Google with G again | **No** new welcome email | |
| 8 | Log out; Continue with Google from the **register** screen with G | **No** new welcome email | |
| 9 | Google sign-in with a Google account whose email already has an email/password account (for example mailbox A, if it is a Google mailbox) | Signs in or links per backend rules; **no** new welcome email (the account already exists) | |
| 10 | Clean up: delete accounts A, B and G in the app (Profile → Delete Account); check no email is sent on deletion beyond what the backend intends | Accounts removed | |

**Pass criteria:** rows 1, 5 and 6 each give exactly one welcome email; every other row gives none.

**If a duplicate email appears:** note the timestamps of both emails and the action that triggered them. Then check the backend logs for two `public_users.create` calls or two sends for the same user before changing anything in the app.
