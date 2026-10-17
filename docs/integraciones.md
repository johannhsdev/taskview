# Integraciones de TaskView

Todas las integraciones que soporta TaskView CE 1.56.0 (verificado en el código del API):

| Integración | Para qué | Variables |
|---|---|---|
| Google login | Botón "Sign in with Google" | `GOOGLE_*` |
| GitHub login | Botón "Sign in with GitHub" | `GITHUB_CLIENT_*` |
| Apple login | Botón "Sign in with Apple" | `APPLE_*` + `secrets/AuthKey.p8` |
| GitHub repos | Issues → tareas, sync por webhook | `GITHUB_INTEGRATION_*` |
| GitLab repos | Issues → tareas, sync por webhook | `GITLAB_INTEGRATION_*` |
| Gitea repos | Issues → tareas, sync por webhook | `GITEA_INTEGRATION_*` |
| Telegram | DMs personales, grupos por proyecto, `/task` | `TELEGRAM_*` |
| Slack | DMs, canales por proyecto, `/task`, botones Done/Assign | `SLACK_*` |
| Firebase | Push en apps iOS/Android | `FIREBASE_CREDENTIALS_PATH` |

Una integración con su ID/secret vacío simplemente no aparece en la UI.
Las URLs de callback ya están en el `.env` y se derivan de `API_PUBLIC_URL`.
Después de llenar variables: `docker compose ... up -d` (recrea el API).

> No hay integración con Jira, Discord, Teams ni Bitbucket.

---

## 0. URLs públicas (requisito)

Slack, Telegram y los webhooks de GitHub/GitLab/Gitea **necesitan HTTPS público**.

| | Local (túnel) | VPS |
|---|---|---|
| Web | `https://tasks-local.slasdevelopments.com` | `https://tasks.slasdevelopments.com` |
| API (`{API}`) | `https://tasks-api-local.slasdevelopments.com` | `https://tasks-api.slasdevelopments.com` |
| MCP | `https://tasks-mcp-local.slasdevelopments.com` | `https://tasks-mcp.slasdevelopments.com` |
| WebSocket | `https://tasks-ws-local.slasdevelopments.com` | `https://tasks-ws.slasdevelopments.com` |

### Túnel local

1. Cloudflare Zero Trust → Networks → Tunnels → **Create tunnel** `taskview-local` (Cloudflared).
2. Copiar el token a `LOCAL_CLOUDFLARE_TUNNEL_TOKEN` en `.env`.
3. Public Hostnames (tipo HTTP):

   | Hostname | Service |
   |---|---|
   | tasks-local | `taskview-webapp:80` |
   | tasks-api-local | `taskview-api-server:1401` |
   | tasks-mcp-local | `taskview-mcp:3100` |
   | tasks-ws-local | `centrifugo:8000` |

4. En `.env` comentar la **Opción A** y descomentar la **Opción B**.
5. `docker compose -f compose.local.yml --profile tunnel up -d`

En el VPS es igual, con el túnel `taskview`, sin el sufijo `-local` y sin `--profile`.

### Una app por entorno

| Proveedor | ¿Una app sirve para local + VPS? |
|---|---|
| Google | Sí: agrega las dos redirect URIs al mismo cliente |
| GitLab / Gitea | Sí: una redirect URI por línea |
| Apple | Sí: varias Return URLs en el Services ID |
| GitHub (login e integración) | **No**: una sola callback por OAuth App → apps `-local` y de producción |
| Slack | **No**: el slash command y la interactividad tienen una sola URL |
| Telegram | **No**: un bot tiene un solo webhook → `@..._local_bot` y `@..._bot` |

---

## 1. Google login

1. https://console.cloud.google.com → nuevo proyecto `TaskView`.
2. APIs & Services → OAuth consent screen → External → nombre, email de soporte → publicar.
3. Credentials → Create credentials → OAuth client ID → **Web application**.
   - Authorized redirect URIs: `{API}/module/auth/provider/google/callback` (local y VPS).
4. Copiar a `GOOGLE_CLIENT_ID` y `GOOGLE_CLIENT_SECRET`.

## 2. GitHub login

1. GitHub → Settings → Developer settings → OAuth Apps → **New OAuth App** (`TaskView Login`).
2. Homepage URL: la URL web. Callback: `{API}/module/auth/provider/github/callback`.
3. Generate a new client secret → `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET`.

## 3. Apple login (requiere Apple Developer, 99 USD/año)

1. developer.apple.com → Identifiers → **App ID** con *Sign in with Apple*.
2. Identifiers → **Services ID** (será `APPLE_CLIENT_ID`) → habilitar Sign in with Apple →
   Domains: el dominio del API; Return URLs: `{API}/module/auth/provider/apple/callback`.
3. Keys → nueva key con *Sign in with Apple* → descargar `.p8` → guardarla como `secrets/AuthKey.p8`.
4. `APPLE_KEY_ID` = ID de la key, `APPLE_TEAM_ID` = Team ID (arriba a la derecha).

## 4. GitHub repos (integración)

OAuth App **distinta** a la de login (esta pide scope `repo`).

1. Developer settings → OAuth Apps → New → `TaskView Integrations`.
2. Callback: `{API}/module/integrations/oauth/github/callback`.
3. → `GITHUB_INTEGRATION_CLIENT_ID` / `GITHUB_INTEGRATION_CLIENT_SECRET`.

Uso: clic derecho en el proyecto → **Integrations** → Add Integration → GitHub → elegir repo.

## 5. GitLab repos

1. GitLab → avatar → Preferences → Applications → **Add new application**.
2. Redirect URI: `{API}/module/integrations/oauth/gitlab/callback` (local y VPS, una por línea).
3. Confidential ✔, scope **api**.
4. → `GITLAB_INTEGRATION_CLIENT_ID` (Application ID) / `GITLAB_INTEGRATION_CLIENT_SECRET`.
5. GitLab self-hosted: descomentar `GITLAB_BASE_URL` y `GITLAB_API_URL`.

## 6. Gitea repos

1. Gitea → Settings → Applications → Manage OAuth2 Applications → **Create Application**.
2. Redirect URI: `{API}/module/integrations/oauth/gitea/callback`.
3. → `GITEA_INTEGRATION_CLIENT_ID` / `GITEA_INTEGRATION_CLIENT_SECRET`.
4. Gitea self-hosted: descomentar `GITEA_BASE_URL`.

## 7. Telegram

1. En Telegram, abrir **@BotFather**:
   - `/newbot` → nombre y usuario (ej. `slas_tasks_bot`; para local `slas_tasks_local_bot`).
   - `/setprivacy` → elegir bot → **Disable** (para leer `/connect` y `/task` en grupos).
   - `/setjoingroups` → **Enable**.
2. `.env`: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME` (sin @). `TELEGRAM_WEBHOOK_SECRET` ya está generado en local.
3. Recrear el API y registrar el webhook:

```bash
bash scripts/telegram-webhook.sh
```

```bash
bash scripts/telegram-webhook.sh info
```

Uso: clic derecho en el proyecto → **Messengers** → Personal (DMs) o Project (grupo: agregar el bot y enviar `/connect <token>`).
En un grupo vinculado: `/task Comprar el dominio`.

## 8. Slack

1. https://api.slack.com/apps → **Create New App** → From scratch → `TaskView` → tu workspace.
2. **OAuth & Permissions**
   - Redirect URL: `{API}/module/messaging/slack/oauth/callback`
   - Bot Token Scopes: `chat:write`, `commands`, `chat:write.public`, `im:write`
3. **Incoming Webhooks** → On.
4. **Slash Commands** → Create: `/task`, Request URL `{API}/module/messaging/slack/commands`.
5. **Interactivity & Shortcuts** → On, Request URL `{API}/module/messaging/slack/interactivity`.
6. **App Home** → Display Name: `TaskView`.
7. Basic Information → App Credentials → `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`, `SLACK_SIGNING_SECRET`.
8. Install to Workspace (reinstalar si cambias scopes o nombre).

Para conectar Slack, abre TaskView **por la URL pública** (no por localhost): Slack exige que el
inicio y el callback del OAuth tengan el mismo origen.

## 9. Firebase (push móvil)

1. https://console.firebase.google.com → nuevo proyecto.
2. Project settings → Service accounts → **Generate new private key**.
3. Guardar el JSON como `secrets/firebase-credentials.json`.
4. En `.env` descomentar `FIREBASE_CREDENTIALS_PATH=/usr/src/app/secrets/firebase-credentials.json`.

Ojo: las apps oficiales de TaskView (App Store / Google Play) se conectan a tu servidor con la URL
del API, pero vienen compiladas con el proyecto Firebase de TaskView. Con tu propio proyecto
Firebase, lo más probable es que el push solo llegue a una app que compiles tú (Capacitor) con
ese proyecto. La documentación no lo aclara.

---

## Permisos en proyectos

- Ver/gestionar integraciones de repos: `integrations_can_view` / `integrations_can_manage`.
- Conectar canales de Slack/Telegram de un proyecto: `integrations_can_manage`.
