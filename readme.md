# TaskView

Self-hosted TaskView (Community Edition) - gestor de proyectos y tareas tipo Jira.

Misma estructura que el repo de `n8n`:

| Archivo | Uso |
|---|---|
| `compose.local.yml` + `.env.local.example` | Local, usa el PostgreSQL de `local-infra-dev` |
| `compose.yml` + `.env.example` | VPS, PostgreSQL propio + Cloudflare Tunnel |
| `centrifugo/config.json` | Notificaciones en tiempo real (secretos van por `.env`) |
| `scripts/init-db.sh` | Crea rol y base de datos en `local_postgres` |
| `scripts/backup.sh` / `restore.sh` | Backup de BD + adjuntos (VPS) |
| `scripts/telegram-webhook.sh` | Registra el webhook del bot de Telegram |
| `secrets/` | Apple `AuthKey.p8` y Firebase JSON (no se sube a git) |
| [`docs/integraciones.md`](docs/integraciones.md) | Paso a paso de GitHub, GitLab, Gitea, Telegram, Slack, Google, Apple y Firebase |

Documentacion oficial: https://taskview.tech/docs

## Arquitectura (VPS)

```text
Internet
   |
   v
Cloudflare  ->  Cloudflare Tunnel (taskview_cloudflared)
   |
   |-- tasks.slasdevelopments.com       -> taskview-webapp:80
   |-- tasks-api.slasdevelopments.com   -> taskview-api-server:1401
   |-- tasks-mcp.slasdevelopments.com   -> taskview-mcp:3100
   |-- tasks-ws.slasdevelopments.com    -> centrifugo:8000
                                              |
                                              v
                                        postgres:5432 (red interna)
```

Se usan subdominios de un solo nivel (`tasks-api.` y no `api.tasks.`) porque el
certificado gratuito de Cloudflare solo cubre `*.slasdevelopments.com`.

## Local

Requisito: `local-infra-dev` levantado (`local_postgres`).

```bash
cp .env.local.example .env       # completar claves y DB_ADMIN_* de local-infra-dev/.env
docker compose -f compose.local.yml --profile tools run --rm db-init
docker compose -f compose.local.yml up -d
```

| Servicio | URL |
|---|---|
| Web app | http://localhost:8888 |
| API | http://localhost:1725 |
| MCP | http://localhost:3100/mcp |
| Centrifugo | ws://localhost:8000/connection/websocket |

Base de datos: `taskview_local` (usuario `taskview`) dentro de `local_postgres`.

Para Slack, Telegram y webhooks de repos hace falta HTTPS público: túnel local
`tasks-local` / `tasks-api-local` / `tasks-mcp-local` / `tasks-ws-local` `.slasdevelopments.com`
(ver [docs/integraciones.md](docs/integraciones.md#túnel-local)) y levantar con:

```bash
docker compose -f compose.local.yml --profile tunnel up -d
```

## VPS

### 1. Cloudflare Tunnel

Cloudflare Zero Trust -> Networks -> Tunnels -> **Create a tunnel** `taskview`
(Cloudflared) -> copiar el token. Public Hostnames (tipo HTTP):

| Hostname | Service |
|---|---|
| tasks.slasdevelopments.com | `taskview-webapp:80` |
| tasks-api.slasdevelopments.com | `taskview-api-server:1401` |
| tasks-mcp.slasdevelopments.com | `taskview-mcp:3100` |
| tasks-ws.slasdevelopments.com | `centrifugo:8000` |

### 2. Servidor

```bash
git clone https://github.com/johannhsdev/taskview.git
cd taskview
cp .env.example .env
bash scripts/generate-secrets.sh
nano .env          # CLOUDFLARE_TUNNEL_TOKEN, SMTP_* y credenciales de integraciones
docker compose pull
docker compose up -d
docker compose ps
```

`migration` debe quedar `Exited (0)` y el resto `Up`. Logs: `docker compose logs -f taskview-api-server`.

### 3. Despues del primer arranque

1. Abrir https://tasks.slasdevelopments.com y reclamar la cuenta por defecto (ver abajo).
2. Si se configuro Telegram: `bash scripts/telegram-webhook.sh`.
3. Backup diario (cron):

```bash
0 3 * * * cd /ruta/taskview && bash scripts/backup.sh >> backups/backup.log 2>&1
```

## Primer ingreso (local y VPS)

La migracion crea un usuario publico por defecto: `user` / `user1!#Q`.
**Reclamarlo de inmediato:** Account settings -> tarjeta *Login and email* ->
poner tu login, email y contrasena -> *Save and sign out*.

Con `ALLOW_PUBLIC_REGISTRATION=false` solo entran correos invitados a una
organizacion o proyecto.

## MCP (Claude)

1. TaskView -> Account settings -> API Tokens -> crear token `tvk_...`
2. Claude Code:

```bash
claude mcp add --transport http taskview http://localhost:3100/mcp --header "Authorization: Bearer tvk_..."
```

En el VPS (`OAUTH_DYNAMIC_REGISTRATION=true`) claude.ai / Claude Desktop pueden
conectarse como *custom connector* con `https://tasks-mcp.slasdevelopments.com/mcp`
sin token (OAuth).

## Webhooks hacia n8n

Proyecto -> clic derecho -> Webhooks -> Add Webhook.

- Local: `http://local_n8n:5678/webhook/<id>` (requiere `WEBHOOKS_ALLOW_PRIVATE_URLS=true`, ya activo).
- VPS: `https://n8n.slasdevelopments.com/webhook/<id>`.

Verificar la firma `X-Webhook-Signature` (HMAC-SHA256 del body con el secret del webhook).

## Actualizar

Cambiar `TASKVIEW_VERSION` en `.env` y:

```bash
docker compose pull && docker compose up -d
```

La migracion corre sola al arrancar.

## Licencia

TaskView CE es *source-available*: uso interno libre (tu equipo), pero no permite
dar acceso a clientes o terceros con la licencia community.
