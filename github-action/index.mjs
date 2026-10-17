// TaskView Kanban - GitHub Action sin dependencias (Node 24, fetch nativo).
// Lee el evento de GitHub, encuentra el codigo de tarea (tv-123) en la rama
// o en el titulo del PR y mueve la tarjeta a la columna configurada.

import { appendFileSync, readFileSync } from 'node:fs';

const input = (name, fallback = '') => {
    const value = process.env[`INPUT_${name.toUpperCase()}`];

    return value === undefined ? fallback : value.trim();
};

const log = (message) => console.log(message);
const warn = (message) => console.log(`::warning title=TaskView::${message}`);
const error = (message) => console.log(`::error title=TaskView::${message}`);

const setOutput = (name, value) => {
    if (process.env.GITHUB_OUTPUT) {
        appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
    }
};

const summary = (markdown) => {
    if (process.env.GITHUB_STEP_SUMMARY) {
        appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${markdown}\n`);
    }
};

const config = {
    apiUrl: input('api-url').replace(/\/+$/, ''),
    token: input('token'),
    pattern: new RegExp(input('task-pattern', '(?:^|[^a-z0-9])tv-(\\d+)(?![0-9])'), 'gi'),
    columns: {
        branchCreated: input('branch-created-column', 'In Progress'),
        prDraft: input('pr-draft-column', ''),
        prOpened: input('pr-opened-column', 'Review'),
        prMerged: input('pr-merged-column', 'Done'),
        prClosed: input('pr-closed-column', ''),
    },
    completeOnMerge: input('complete-on-merge', 'true') === 'true',
    createMissingColumns: input('create-missing-columns', 'true') === 'true',
    failOnError: input('fail-on-error', 'false') === 'true',
};


// ------------------------------------------------
// 1. Que paso en GitHub
// ------------------------------------------------

function resolveEvent(eventName, event) {
    if (eventName === 'create') {
        if (event.ref_type !== 'branch') {
            return null;
        }

        return { text: event.ref, column: config.columns.branchCreated, complete: false, label: `rama ${event.ref}` };
    }

    if (eventName === 'pull_request' || eventName === 'pull_request_target') {
        const pr = event.pull_request;
        const text = `${pr.head.ref} ${pr.title || ''}`;
        const label = `PR #${pr.number}`;

        switch (event.action) {
            case 'opened':
            case 'reopened':
            case 'ready_for_review':
                return pr.draft
                    ? { text, column: config.columns.prDraft, complete: false, label: `${label} (draft)` }
                    : { text, column: config.columns.prOpened, complete: false, label };
            case 'converted_to_draft':
                return { text, column: config.columns.prDraft, complete: false, label: `${label} (draft)` };
            case 'closed':
                return pr.merged
                    ? { text, column: config.columns.prMerged, complete: config.completeOnMerge, label: `${label} mergeado` }
                    : { text, column: config.columns.prClosed, complete: false, label: `${label} cerrado` };
            default:
                return null;
        }
    }

    return null;
}

function extractTaskIds(text) {
    const ids = new Set();

    for (const match of text.matchAll(config.pattern)) {
        ids.add(Number(match[1]));
    }

    return [...ids];
}


// ------------------------------------------------
// 2. API de TaskView (respuestas envueltas en { response })
// ------------------------------------------------

async function api(method, path, body) {
    const response = await fetch(`${config.apiUrl}${path}`, {
        method,
        headers: {
            Authorization: `Bearer ${config.token}`,
            Accept: 'application/json',
            'Content-Type': 'application/json',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
    });

    const text = await response.text();

    if (!response.ok) {
        throw new Error(`${method} ${path} -> HTTP ${response.status} ${text.slice(0, 200)}`);
    }

    try {
        return JSON.parse(text).response;
    } catch {
        return null;
    }
}

async function moveTask(taskId, columnName, complete) {
    const task = await api('GET', `/module/tasks/${taskId}`);

    if (!task) {
        warn(`La tarea ${taskId} no existe o el token no tiene acceso.`);
        return `| ${taskId} | - | no encontrada |`;
    }

    const columns = (await api('POST', '/module/kanban/fetch-statuses', { goalId: task.goalId })) || [];
    let column = columns.find((c) => c.name.trim().toLowerCase() === columnName.trim().toLowerCase());

    if (!column) {
        if (!config.createMissingColumns) {
            warn(`El proyecto ${task.goalId} no tiene la columna "${columnName}".`);
            return `| ${taskId} | ${task.description} | falta columna "${columnName}" |`;
        }

        column = await api('POST', '/module/kanban/add-status', { goalId: task.goalId, name: columnName });
        log(`Columna "${columnName}" creada en el proyecto ${task.goalId}.`);
    }

    const actions = [];

    if (task.statusId !== column.id) {
        await api('PATCH', '/module/kanban/update-tasks-order-and-column', {
            goalId: task.goalId,
            columnId: column.id,
            taskId: task.id,
            prevTaskId: null,
            nextTaskId: null,
        });
        actions.push(`movida a ${column.name}`);
    } else {
        actions.push(`ya estaba en ${column.name}`);
    }

    if (complete && !task.complete) {
        await api('PATCH', '/module/tasks', { id: task.id, complete: true });
        actions.push('completada');
    }

    log(`Tarea ${taskId} "${task.description}": ${actions.join(', ')}.`);

    return `| ${taskId} | ${task.description} | ${actions.join(', ')} |`;
}


// ------------------------------------------------
// 3. Main
// ------------------------------------------------

async function main() {
    if (!config.apiUrl || !config.token) {
        error('Faltan api-url o token.');
        process.exitCode = 1;
        return;
    }

    const eventName = process.env.GITHUB_EVENT_NAME;
    const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
    const resolved = resolveEvent(eventName, event);

    if (!resolved || !resolved.column) {
        log(`Evento ${eventName}/${event.action || event.ref_type || ''} sin columna configurada. Nada que hacer.`);
        return;
    }

    const taskIds = extractTaskIds(resolved.text);

    if (taskIds.length === 0) {
        log(`Sin codigo de tarea en "${resolved.text.trim()}". Nada que hacer.`);
        return;
    }

    setOutput('task-ids', taskIds.join(','));
    setOutput('column', resolved.column);

    const rows = [];
    let failed = false;

    for (const taskId of taskIds) {
        try {
            rows.push(await moveTask(taskId, resolved.column, resolved.complete));
        } catch (e) {
            failed = true;
            (config.failOnError ? error : warn)(`Tarea ${taskId}: ${e.message}`);
            rows.push(`| ${taskId} | - | error: ${e.message.slice(0, 80)} |`);
        }
    }

    summary(`### TaskView Kanban\n\n${resolved.label} -> **${resolved.column}**\n\n| Tarea | Titulo | Resultado |\n|---|---|---|\n${rows.join('\n')}`);

    if (failed && config.failOnError) {
        process.exitCode = 1;
    }
}

main().catch((e) => {
    error(e.message);
    process.exitCode = config.failOnError ? 1 : 0;
});
