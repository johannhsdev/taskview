# GitHub → Kanban de TaskView

Las tarjetas del Kanban se mueven solas según lo que pasa en GitHub, con la acción
[`github-action/`](../github-action) de este repo. No usa issues ni n8n: las tareas se crean
en TaskView y GitHub solo avisa del avance.

> La integración nativa de TaskView con GitHub solo sincroniza **issues creados en GitHub**
> (los cierra/reabre) y no mueve columnas. Por eso esta acción.

Solo aplica a proyectos de desarrollo con repo. Los tableros de otro tipo (redes sociales,
operaciones, etc.) se manejan a mano y no necesitan nada de esto.

Cada repo elige su flujo copiando una plantilla y ajustando sus reglas:

| Plantilla | Flujo |
|---|---|
| [`taskview.example.yml`](../github-action/taskview.example.yml) | Desarrollo con `develop` / `qa` / `main` (flujo estándar) |
| [`taskview.simple.example.yml`](../github-action/taskview.simple.example.yml) | Una sola rama principal: rama → PR → merge |

---

## Flujo estándar (develop / qa / main)

```text
 Backlog ──► Dev ──────► Review ─────► QA ─────────► Done
 manual     rama        PR abierto    merge a qa     merge a main
            tv-12-...                                (+ completada = en producción)
```

| Evento en GitHub | Columna |
|---|---|
| Se crea y asigna la tarea | Backlog (manual) |
| Rama `tv-12-login` (historia) o `tv-13-api` (subtarea) | **Dev** |
| PR abierto: subtarea → historia, historia → develop / qa | **Review** |
| Merge a una rama de historia | no mueve (la subtarea sigue en Review) |
| Merge a `develop` | no mueve (integrado, esperando QA) |
| Merge a `qa` | **QA** |
| Merge a `main` (develop → main o historia → main) | **Done** + completada |
| PR en draft / cerrado sin merge | no mueve |

### Historias y subtareas

```text
main ◄── qa ◄── develop ◄── tv-12-login (historia)
                               ▲      ▲
                       tv-13-api    tv-14-ui (subtareas)
```

1. `tv-12-login`, `tv-13-api` y `tv-14-ui` se crean → las tres pasan a **Dev**.
2. PR `tv-13-api → tv-12-login` → la 13 pasa a **Review**. Su merge no la mueve.
3. PR `tv-12-login → develop` → la 12 pasa a **Review**.
4. Merge `develop → qa` → **12, 13 y 14 pasan a QA**.
5. Merge `develop → main` → **12, 13 y 14 pasan a Done** y quedan completadas.

En los pasos 4 y 5 la rama origen (`develop`) no tiene código de tarea: la acción lee los
**commits del PR**. Los merges traen el nombre de la rama ("Merge pull request #8 from
org/tv-13-api") y los squash traen el título del PR, así encuentra todas las tareas que
viajan dentro.

**Nunca retrocede** (`only-forward`): si una tarea ya está en QA, abrir el PR `develop → main`
no la regresa a Review.

### Columnas del proyecto

`only-forward` usa el orden de las columnas, que en TaskView es el **orden de creación** (aún
no se pueden reordenar). Un proyecto nuevo trae `TODO`, `In Progress` y `Done`. Para dejarlo
como `Backlog → Dev → Review → QA → Done`, antes de tener tareas:

1. Renombra `TODO` → `Backlog`, `In Progress` → `Dev` y `Done` → `Review`.
2. Agrega las columnas `QA` y luego `Done`, en ese orden.

Por eso la plantilla estándar usa `create-missing-columns: 'false'`: si falta una columna,
la acción avisa en lugar de crearla al final.

---

## Reglas

```yaml
rules: |
  branch            = Dev
  pr_draft          =
  pr_opened         = Review
  pr_merged@qa      = QA
  pr_merged@main    = Done, complete
  pr_merged@develop =
  pr_merged         =
  pr_closed         =
```

Formato: `evento[@rama-destino] = Columna[, complete][, force]`

| Parte | Valores |
|---|---|
| evento | `branch` (rama creada), `pr_draft`, `pr_opened` (abierto / reabierto / listo), `pr_merged`, `pr_closed` (cerrado sin merge) |
| `@rama-destino` | Opcional. Rama base del PR; acepta `*` (`release/*`, `hotfix-*`). Sin ella, aplica a cualquier rama |
| Columna | Nombre exacto (sin importar mayúsculas). Vacío = no mover |
| `complete` | Además marca la tarea como completada |
| `force` | Permite mover hacia atrás (ignora `only-forward`). Ej: `pr_closed = Backlog, force` |

Gana la **primera** regla que coincide, así que las específicas (`@qa`, `@main`) van antes que
las generales. Una regla mal escrita hace fallar el job con el número de línea.

### Ejemplos de otros flujos

```yaml
# Con staging y releases
rules: |
  branch                = In Progress
  pr_opened             = Code Review
  pr_merged@staging     = Staging
  pr_merged@release/*   = Release
  pr_merged@main        = Done, complete

# Devolver a TODO si se cierra el PR sin merge
rules: |
  branch    = In Progress
  pr_opened = Review
  pr_merged = Done, complete
  pr_closed = TODO, force
```

---

## Historias, tareas y bugs en TaskView

TaskView 1.56.0 no tiene tipos de tarea ni claves por proyecto, y sus **subtareas nativas no
aparecen en el Kanban** (son una checklist dentro de la tarjeta). Para que cada pieza con rama
propia sea una tarjeta que se mueva:

| Concepto | Cómo se crea en TaskView |
|---|---|
| Historia de usuario | Tarea normal con etiqueta **Historia** |
| Subtarea (con rama propia) | Tarea normal con etiqueta **Subtarea** (o **Bug**) |
| Agrupar historia + subtareas | Una **lista** por historia (ej. `HU Login`) con la historia y sus tareas dentro |
| Orden entre ellas | **Dependency Graph**: subtareas → historia |
| Pasos pequeños sin rama | Subtareas nativas (checklist) dentro de la tarjeta |

Con la lista por historia, el Kanban se puede filtrar por lista y ver solo esa historia.

Al crear una tarea TaskView le asigna su número automáticamente (único en toda la instancia,
no por proyecto). Se ve como `#57` en el detalle de la tarea; un clic lo copia. La rama queda
`tv-57-descripcion`.

## Código de tarea

Es el ID de la tarea en TaskView: botón `#57` en el detalle de la tarea (**Copy task ID**).

`tv-` es solo el prefijo que reconoce la acción, no algo de TaskView. Cada repo puede usar el
suyo con `task-pattern`, por ejemplo `crm-57-login`:

```yaml
task-pattern: '(?:^|[^a-z0-9])crm[-_ ](\d+)(?![0-9])'
```

No usar un patrón genérico tipo `[a-z]+-(\d+)`: ramas como `release-2` moverían la tarea 2.

| Válido | No válido |
|---|---|
| `tv-123-login-google` | `tv123-login` (falta separador) |
| `feature/tv-123`, `fix_TV-123_crash` | `login-123` |
| Título del PR: `TV-123 Login con Google` | |
| Título autogenerado por GitHub: `Tv 123 login` | |
| Varias en un PR: `tv-12 tv-15 Refactor auth` | |

El patrón se cambia con `task-pattern` (regex, grupo 1 = ID).

## Instalar en un repo de código

1. **Token en TaskView**: Account settings → API Tokens → Create Token `github-<repo>`.
   Permisos mínimos: `component_can_watch_content`, `kanban_can_view`, `kanban_can_manage`,
   `task_can_edit_status`. Restringirlo a los proyectos de ese repo.
2. **Secret en GitHub**: repo → Settings → Secrets and variables → Actions →
   New repository secret `TASKVIEW_TOKEN`.
3. **Workflow**: copiar la plantilla a `.github/workflows/taskview.yml` y ajustar `rules`.
   Debe estar en la rama por defecto **y** en las ramas desde donde se crean las demás
   (`develop`), porque GitHub ejecuta el workflow de la rama del evento.

La acción se referencia como `johannhsdev/taskview/github-action@v1`. Al publicar cambios
compatibles se mueve el tag `v1` y todos los repos los toman sin tocar nada.

## Todas las opciones

| Input | Default | Qué hace |
|---|---|---|
| `api-url` | — | `https://tasks-api.slasdevelopments.com` |
| `token` | — | `${{ secrets.TASKVIEW_TOKEN }}` |
| `rules` | — | Reglas (ver arriba). Si se define, ignora las opciones `*-column` |
| `only-forward` | `true` con `rules` | No mover hacia atrás |
| `scan-commits` | `true` | Leer códigos en los commits del PR |
| `github-token` | `github.token` | Para leer commits (`permissions: pull-requests: read`) |
| `create-missing-columns` | `true` | Crear la columna si no existe (al final del tablero) |
| `task-pattern` | `tv[-_ ](\d+)` | Regex del código |
| `fail-on-error` | `false` | `true` = el check falla si TaskView da error |
| `branch-created-column`, `pr-draft-column`, `pr-opened-column`, `pr-merged-column`, `pr-closed-column`, `complete-on-merge` | flujo simple | Modo v1, sin `rules` |

## Verificar

Cada ejecución deja un resumen en GitHub → Actions → el run → *Summary*:

```text
PR #5 develop -> main mergeado -> Done (completar)
| 12 | Historia login | movida a Done, completada |
| 13 | Sub API        | movida a Done, completada |
```

Errores típicos (aparecen como *warning* sin romper el PR):

- `HTTP 401`: token inválido o vencido.
- `no existe o el token no tiene acceso`: ID equivocado o token restringido a otro proyecto.
- `HTTP 403`: al token le falta `kanban_can_manage` o `task_can_edit_status`.
- `no se pudieron leer los commits`: falta `permissions: pull-requests: read` en el workflow.
- `falta columna "QA"`: el proyecto no tiene esa columna y `create-missing-columns` está en `false`.

No cubre: pushes directos a `main` sin PR, reviews aprobados/rechazados ni deploys.

## Pruebas

- **v1 contra TaskView real** (17-10-2026, repo público temporal + túnel de Cloudflare):
  rama → In Progress, PR → Review (columna creada), merge → Done y completada.
- **Reglas contra API simulado** (TaskView + GitHub): el flujo estándar completo con una
  historia y dos subtareas (rama, PR draft, PR listo, merge a historia, a develop, a qa y a
  main), no retroceder, `force`, regla inválida, título autogenerado `Tv 30` y el modo v1 sin
  `rules`.
