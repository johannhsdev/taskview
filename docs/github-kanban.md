# GitHub → Kanban de TaskView

Las tarjetas del Kanban se mueven solas según lo que pasa en GitHub, con la acción
[`github-action/`](../github-action) de este repo. No usa issues ni n8n: las tareas se crean
en TaskView y GitHub solo avisa del avance.

> La integración nativa de TaskView con GitHub solo sincroniza **issues creados en GitHub**
> (los cierra/reabre) y no mueve columnas. Por eso esta acción.

## Proceso

```text
 Backlog ──► TODO ──► In Progress ──► Review ──► Done
   manual    manual    rama tv-123     PR abierto  PR mergeado
   (idea)   (sprint)                              (+ completada)
```

| Paso | Quién lo hace | Columna |
|---|---|---|
| Se registra la tarea | Tú, en TaskView | Backlog |
| Entra al sprint / se prioriza | Tú, en TaskView | TODO |
| Se crea la rama `tv-123-...` | GitHub Action | In Progress |
| Se abre el PR | GitHub Action | Review |
| Se mergea el PR | GitHub Action | Done + completada |
| PR en draft / cerrado sin merge | No mueve (configurable) | — |

TaskView crea por defecto `Backlog`, `TODO`, `In Progress` y `Done` en cada proyecto.
`Review` la crea la acción la primera vez (`create-missing-columns: 'true'`), o créala tú.
Las columnas se muestran en el orden en que se crearon (TaskView aún no permite reordenarlas).

## Código de tarea

Es el ID de la tarea en TaskView: menú de la tarea → **Copy task ID**.

| Válido | No válido |
|---|---|
| `tv-123-login-google` | `tv123-login` (falta el guion) |
| `feature/tv-123` | `login-123` |
| `fix_TV-123_crash` | |
| Título del PR: `TV-123 Login con Google` | |
| Varias: `tv-12 tv-15 Refactor auth` | |

El patrón se cambia con `task-pattern`.

## Instalar en un repo de código

1. **Token en TaskView**: Account settings → API Tokens → Create Token `github-<repo>`.
   Permisos mínimos: `component_can_watch_content`, `kanban_can_view`, `kanban_can_manage`,
   `task_can_edit_status`. Restringirlo a los proyectos de ese repo.
2. **Secret en GitHub**: repo → Settings → Secrets and variables → Actions →
   New repository secret `TASKVIEW_TOKEN`.
3. **Workflow**: copiar [`github-action/taskview.example.yml`](../github-action/taskview.example.yml)
   a `.github/workflows/taskview.yml` y ajustar las columnas.

La acción se referencia como `johannhsdev/taskview/github-action@v1`. Al publicar cambios
se mueve el tag `v1` y todos los repos los toman sin tocar nada.

## Configuración

| Input | Default | Qué hace |
|---|---|---|
| `api-url` | — | `https://tasks-api.slasdevelopments.com` |
| `token` | — | `${{ secrets.TASKVIEW_TOKEN }}` |
| `branch-created-column` | `In Progress` | Columna al crear la rama |
| `pr-draft-column` | vacío | Columna al abrir un PR en draft |
| `pr-opened-column` | `Review` | Columna al abrir/reabrir/marcar listo el PR |
| `pr-merged-column` | `Done` | Columna al mergear |
| `pr-closed-column` | vacío | Columna al cerrar sin mergear (ej. `TODO`) |
| `complete-on-merge` | `true` | Marcar completada al mergear |
| `create-missing-columns` | `true` | Crear la columna si no existe |
| `task-pattern` | `tv-(\d+)` | Regex del código (grupo 1 = ID) |
| `fail-on-error` | `false` | `true` = el check falla si TaskView da error |

Vacío = ese evento no mueve la tarjeta.

## Verificar

Cada ejecución deja un resumen en GitHub → Actions → el run → *Summary*:

```text
PR #5 mergeado -> Done
| 123 | Login con Google | movida a Done, completada |
```

Errores típicos (aparecen como *warning* sin romper el PR):

- `HTTP 401`: token inválido o vencido.
- `no existe o el token no tiene acceso`: ID equivocado o token restringido a otro proyecto.
- `HTTP 403`: al token le falta `kanban_can_manage` o `task_can_edit_status`.

## Estado

Probada contra un API simulado (rama, rama sin código, tag, draft, PR con columna faltante,
merge, tarea inexistente, token inválido). La primera validación contra TaskView real se
hace en producción con la primera rama `tv-<id>`.
