// TaskView Kanban - GitHub Action sin dependencias (Node 24, fetch nativo).
// Lee el evento de GitHub, encuentra los codigos de tarea (tv-123) en la rama,
// el titulo del PR y sus commits, y mueve las tarjetas segun reglas
// por evento y rama destino.

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
    // tv-13, tv_13 y "Tv 13" (titulo que GitHub genera desde la rama tv-13-...)
    pattern: new RegExp(input('task-pattern', '(?:^|[^a-z0-9])tv[-_ ](\\d+)(?![0-9])'), 'gi'),
    onlyForward: input('only-forward', ''),
    scanCommits: input('scan-commits', 'true') === 'true',
    githubToken: input('github-token'),
    createMissingColumns: input('create-missing-columns', 'true') === 'true',
    failOnError: input('fail-on-error', 'false') === 'true',
};


// ------------------------------------------------
// 1. Reglas
// ------------------------------------------------

const EVENTS = ['branch', 'pr_draft', 'pr_opened', 'pr_merged', 'pr_closed'];

// "pr_merged@main = Done, complete"  ->  { event, base, column, complete, force }
export function parseRules(text) {
    const rules = [];

    for (const [index, rawLine] of text.split(/\r?\n/).entries()) {
        const line = rawLine.replace(/#.*$/, '').trim();

        if (!line) {
            continue;
        }

        const match = line.match(/^([a-z_]+)(?:@(\S+))?\s*=\s*(.*)$/i);

        if (!match || !EVENTS.includes(match[1].toLowerCase())) {
            throw new Error(`Regla invalida en linea ${index + 1}: "${rawLine.trim()}"`);
        }

        const [column, ...flags] = match[3].split(',').map((part) => part.trim());

        rules.push({
            event: match[1].toLowerCase(),
            base: match[2] || null,
            column,
            complete: flags.includes('complete'),
            force: flags.includes('force'),
        });
    }

    return rules;
}

// Compatibilidad con v1: las opciones *-column se convierten en reglas.
function legacyRules() {
    const line = (event, column, flags = []) => `${event} = ${[column, ...flags].join(', ')}`;
    const complete = input('complete-on-merge', 'true') === 'true' ? ['complete'] : [];

    return parseRules([
        line('branch', input('branch-created-column', 'In Progress')),
        line('pr_draft', input('pr-draft-column', '')),
        line('pr_opened', input('pr-opened-column', 'Review')),
        line('pr_merged', input('pr-merged-column', 'Done'), complete),
        line('pr_closed', input('pr-closed-column', ''), ['force']),
    ].join('\n'));
}

function globToRegExp(glob) {
    const escaped = glob.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');

    return new RegExp(`^${escaped}$`, 'i');
}

export function findRule(rules, event, base) {
    return rules.find((rule) => rule.event === event
        && (!rule.base || !base || globToRegExp(rule.base).test(base))) || null;
}


// ------------------------------------------------
// 2. Que paso en GitHub
// ------------------------------------------------

export function resolveEvent(eventName, event) {
    if (eventName === 'create') {
        if (event.ref_type !== 'branch') {
            return null;
        }

        return { event: 'branch', base: null, texts: [event.ref], label: `rama ${event.ref}`, pr: null };
    }

    if (eventName !== 'pull_request' && eventName !== 'pull_request_target') {
        return null;
    }

    const pr = event.pull_request;
    const base = pr.base?.ref || null;
    const texts = [pr.head.ref, pr.title || ''];
    const label = `PR #${pr.number} ${pr.head.ref} -> ${base}`;
    const common = { base, texts, pr };

    switch (event.action) {
        case 'opened':
        case 'reopened':
        case 'ready_for_review':
            return pr.draft
                ? { ...common, event: 'pr_draft', label: `${label} (draft)` }
                : { ...common, event: 'pr_opened', label };
        case 'converted_to_draft':
            return { ...common, event: 'pr_draft', label: `${label} (draft)` };
        case 'closed':
            return pr.merged
                ? { ...common, event: 'pr_merged', label: `${label} mergeado` }
                : { ...common, event: 'pr_closed', label: `${label} cerrado` };
        default:
            return null;
    }
}

export function extractTaskIds(texts) {
    const ids = new Set();

    for (const text of texts) {
        for (const match of String(text).matchAll(config.pattern)) {
            ids.add(Number(match[1]));
        }
    }

    return [...ids];
}

// Mensajes de commits del PR (merge commits traen la rama origen: "Merge pull request #8 from org/tv-12-login").
async function fetchPrCommitMessages(pr) {
    const apiUrl = process.env.GITHUB_API_URL || 'https://api.github.com';
    const repo = process.env.GITHUB_REPOSITORY;
    const messages = [];

    if (!repo || !config.githubToken) {
        warn('Sin GITHUB_REPOSITORY o github-token: no se leen los commits del PR.');
        return messages;
    }

    for (let page = 1; page <= 3; page++) {
        const response = await fetch(`${apiUrl}/repos/${repo}/pulls/${pr.number}/commits?per_page=100&page=${page}`, {
            headers: {
                Authorization: `Bearer ${config.githubToken}`,
                Accept: 'application/vnd.github+json',
                'X-GitHub-Api-Version': '2022-11-28',
            },
        });

        if (!response.ok) {
            warn(`No se pudieron leer los commits del PR #${pr.number} (HTTP ${response.status}). Revisa permissions: pull-requests: read.`);
            break;
        }

        const commits = await response.json();

        messages.push(...commits.map((commit) => commit.commit?.message || ''));

        if (commits.length < 100) {
            break;
        }
    }

    return messages;
}


// ------------------------------------------------
// 3. API de TaskView (respuestas envueltas en { response })
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

const columnsCache = new Map();

async function projectColumns(goalId) {
    if (!columnsCache.has(goalId)) {
        columnsCache.set(goalId, (await api('POST', '/module/kanban/fetch-statuses', { goalId })) || []);
    }

    return columnsCache.get(goalId);
}

async function moveTask(taskId, rule) {
    const task = await api('GET', `/module/tasks/${taskId}`);

    if (!task) {
        warn(`La tarea ${taskId} no existe o el token no tiene acceso.`);
        return `| ${taskId} | - | no encontrada |`;
    }

    const columns = await projectColumns(task.goalId);
    const sameName = (c) => c.name.trim().toLowerCase() === rule.column.trim().toLowerCase();
    let column = columns.find(sameName);

    if (!column) {
        if (!config.createMissingColumns) {
            warn(`El proyecto ${task.goalId} no tiene la columna "${rule.column}".`);
            return `| ${taskId} | ${task.description} | falta columna "${rule.column}" |`;
        }

        column = await api('POST', '/module/kanban/add-status', { goalId: task.goalId, name: rule.column });
        columns.push(column);
        log(`Columna "${rule.column}" creada en el proyecto ${task.goalId}.`);
    }

    const actions = [];
    const currentIndex = columns.findIndex((c) => c.id === task.statusId);
    const targetIndex = columns.findIndex((c) => c.id === column.id);

    if (task.statusId === column.id) {
        actions.push(`ya estaba en ${column.name}`);
    } else if (config.onlyForward && !rule.force && currentIndex > targetIndex) {
        actions.push(`sigue en ${columns[currentIndex].name} (no retrocede a ${column.name})`);
    } else {
        await api('PATCH', '/module/kanban/update-tasks-order-and-column', {
            goalId: task.goalId,
            columnId: column.id,
            taskId: task.id,
            prevTaskId: null,
            nextTaskId: null,
        });
        actions.push(`movida a ${column.name}`);
    }

    if (rule.complete && !task.complete) {
        await api('PATCH', '/module/tasks', { id: task.id, complete: true });
        actions.push('completada');
    }

    log(`Tarea ${taskId} "${task.description}": ${actions.join(', ')}.`);

    return `| ${taskId} | ${task.description} | ${actions.join(', ')} |`;
}


// ------------------------------------------------
// 4. Main
// ------------------------------------------------

async function main() {
    if (!config.apiUrl || !config.token) {
        error('Faltan api-url o token.');
        process.exitCode = 1;
        return;
    }

    const rulesText = input('rules');
    const rules = rulesText ? parseRules(rulesText) : legacyRules();

    // Sin valor explicito: solo avanzar con rules, comportamiento v1 sin ellas.
    config.onlyForward = config.onlyForward === '' ? Boolean(rulesText) : config.onlyForward === 'true';

    const eventName = process.env.GITHUB_EVENT_NAME;
    const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
    const resolved = resolveEvent(eventName, event);

    if (!resolved) {
        log(`Evento ${eventName}/${event.action || event.ref_type || ''} no soportado. Nada que hacer.`);
        return;
    }

    const rule = findRule(rules, resolved.event, resolved.base);

    if (!rule || !rule.column) {
        log(`${resolved.label}: ninguna regla mueve tarjetas (${resolved.event}${resolved.base ? `@${resolved.base}` : ''}).`);
        return;
    }

    const texts = [...resolved.texts];

    if (resolved.pr && config.scanCommits) {
        texts.push(...await fetchPrCommitMessages(resolved.pr));
    }

    const taskIds = extractTaskIds(texts);

    if (taskIds.length === 0) {
        log(`${resolved.label}: sin codigos de tarea. Nada que hacer.`);
        return;
    }

    setOutput('task-ids', taskIds.join(','));
    setOutput('column', rule.column);

    const rows = [];
    let failed = false;

    for (const taskId of taskIds) {
        try {
            rows.push(await moveTask(taskId, rule));
        } catch (e) {
            failed = true;
            (config.failOnError ? error : warn)(`Tarea ${taskId}: ${e.message}`);
            rows.push(`| ${taskId} | - | error: ${e.message.slice(0, 80)} |`);
        }
    }

    summary(`### TaskView Kanban\n\n${resolved.label} -> **${rule.column}**${rule.complete ? ' (completar)' : ''}\n\n| Tarea | Titulo | Resultado |\n|---|---|---|\n${rows.join('\n')}`);

    if (failed && config.failOnError) {
        process.exitCode = 1;
    }
}

if (process.env.GITHUB_EVENT_PATH) {
    main().catch((e) => {
        error(e.message);
        process.exitCode = config.failOnError || e.message.startsWith('Regla invalida') ? 1 : 0;
    });
}
