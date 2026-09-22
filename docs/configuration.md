# Configuration

Everything is an environment variable in `.env`. The container refuses to start on a combination that
cannot work, and says which one, rather than failing at somebody's first sign-in.

## Required

| Variable | |
|---|---|
| `DOUBLEOH_ADMIN_EMAIL`, `DOUBLEOH_ADMIN_PASSWORD` | The administrator. Both or neither, password 12 characters or more. A changed password in `.env` is the new password after a restart. |
| `BETTER_AUTH_SECRET` | Signs sessions. `openssl rand -base64 48`. At least 32 characters. |
| `BETTER_AUTH_URL`, `APP_ORIGIN`, `FIX_ORIGIN`, `TRUSTED_ORIGINS` | Where people open DoubleOh. `http://localhost:3001` on a laptop, `https://your.domain` behind TLS. Change all four together. |
| `KEY_ENCRYPTION_KEY` | Base64, 32 bytes. `openssl rand -base64 32`. Encrypts stored credentials; losing it orphans them. |
| `MANAGED_AGENT_TOKEN` | `openssl rand -base64 32`. |
| `MANAGED_AGENT_AG_UI_URL` | The AG-UI endpoint for chat agents created in the product. Optional feature, so a dead address is fine and only switches chat off. |
| `ANTHROPIC_API_KEY` | The skill compiler's vision model. |

## Database

| Variable | Default | |
|---|---|---|
| `EMBEDDED_POSTGRES` | `on` | PostgreSQL inside the container, migrations run at every start. Mount `/var/lib/postgresql/data`. |
| `DATABASE_URL` | internal | Your own PostgreSQL with the `vector` extension. Set it and switch `EMBEDDED_POSTGRES` to `off`. Migrations become a release step, see deployment. |

## Sign-in with an identity provider

Instead of, or beside, the password administrator.

| Variable | |
|---|---|
| `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET` | Google. Both or neither. |
| `MICROSOFT_OAUTH_*`, `OKTA_OAUTH_*` | Microsoft, Okta. Same shape. |
| `INITIAL_ADMIN_EMAILS` | Comma-separated. Who is an administrator on first sign-in. The password administrator is added automatically. |

## Optional

| Variable | Default | |
|---|---|---|
| `OPENAI_API_KEY` | unset | The built-in chat agents. |
| `ELEVENLABS_API_KEY` | unset | Dictation in the composer. |
| `EMBEDDING_API_KEY` | unset | Embeddings for document search. |
| `AUDIT_RETENTION_DAYS` | forever | Whole days. The audit trail older than this is deleted. |
| `AGENT_STALL_TIMEOUT_MS` | `0`, off | How long an agent's stream may say nothing before its turn is ended. |
| `COMPUTER_TOKEN` | generated | The API's credential to the browser beside it. Generated at start, nothing to share it with. |
| `PORT` | `3001` | |
