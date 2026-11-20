const { createHash } = require('node:crypto');
const { mkdirSync, readFileSync, renameSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');

const identifier = /^[a-z][a-z0-9.-]*$/;
const version = /^\d+\.\d+\.\d+$/;
const packageKey = (entry) => `${entry.id}@${entry.version}`;

function validateTheme(theme, entry) {
  if (theme.schemaVersion !== 1 || theme.id !== entry.id || theme.version !== entry.version ||
      !theme.title || !theme.author || !theme.license || !Array.isArray(theme.concepts)) {
    throw new Error('Pacote incompatível com o índice.');
  }
  const concepts = new Map(theme.concepts.map((concept) => [concept.id, concept]));
  if (concepts.size !== theme.concepts.length) throw new Error('Conceitos duplicados.');
  for (const concept of concepts.values()) {
    if (!identifier.test(concept.id) || typeof concept.title !== 'string' ||
        !Array.isArray(concept.prerequisites)) throw new Error('Conceito inválido.');
    const verify = (id, ancestors) => {
      if (!concepts.has(id) || ancestors.has(id)) throw new Error('Pré-requisito inválido.');
      for (const prerequisite of concepts.get(id).prerequisites) {
        verify(prerequisite, new Set([...ancestors, id]));
      }
    };
    verify(concept.id, new Set());
  }
  const technique = theme.technique;
  if (!technique || !identifier.test(technique.id) || !version.test(technique.version) ||
      typeof technique.title !== 'string' || !Array.isArray(technique.steps) || !technique.steps.length ||
      new Set(technique.steps.map((step) => step.id)).size !== technique.steps.length ||
      technique.steps.some((step) => !identifier.test(step.id) || !concepts.has(step.conceptId) ||
        !['flashcard', 'question', 'challenge'].includes(step.kind) ||
        typeof step.prompt !== 'string' || typeof step.answer !== 'string')) {
    throw new Error('Técnica de estudo inválida.');
  }
  return theme;
}

function activate(ctx) {
  const registry = join(__dirname, 'registry');
  const remote = process.env.OPE_REGISTRY_URL ? new URL(process.env.OPE_REGISTRY_URL) : null;
  if (remote && (remote.protocol !== 'https:' || remote.username || remote.password ||
      remote.search || remote.hash || !remote.pathname.endsWith('/'))) {
    throw new Error('OPE_REGISTRY_URL deve ser uma URL HTTPS de diretório.');
  }

  async function readRegistry(path) {
    if (!remote) return readFileSync(join(registry, path));
    const response = await fetch(new URL(path, remote), {
      redirect: 'error',
      signal: AbortSignal.timeout(8000)
    });
    if (!response.ok || !response.body) throw new Error('Registry indisponível.');
    const chunks = [];
    let size = 0;
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > 1024 * 1024) throw new Error('Arquivo do registry excede 1 MiB.');
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }

  async function loadIndex() {
    const index = JSON.parse(await readRegistry('index.json'));
    if (index.schemaVersion !== 1 || !Array.isArray(index.themes) ||
        new Set(index.themes.map(packageKey)).size !== index.themes.length ||
        index.themes.some((entry) => !identifier.test(entry.id) || !version.test(entry.version) ||
          !/^themes\/[a-z0-9.-]+\.json$/.test(entry.path) || !/^[a-f0-9]{64}$/.test(entry.sha256))) {
      throw new Error('Índice inválido.');
    }
    return index;
  }
  mkdirSync(ctx.dataDirectory, { recursive: true });
  const stateFile = join(ctx.dataDirectory, 'study.json');
  let state = {};
  try {
    state = JSON.parse(readFileSync(stateFile, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  function save(key, record) {
    const next = { ...state, [key]: record };
    writeFileSync(stateFile + '.tmp', JSON.stringify(next));
    renameSync(stateFile + '.tmp', stateFile);
    state = next;
    return record;
  }

  ctx.handle('catalog', async () => {
    const installed = Object.values(state).map(({ theme }) => ({
      id: theme.id, version: theme.version, title: theme.title
    }));
    try {
      return { themes: (await loadIndex()).themes, installed };
    } catch (error) {
      return { themes: [], installed, registryError: error.message };
    }
  });
  ctx.handle('openTheme', ({ key }) => {
    if (!Object.hasOwn(state, key)) throw new Error('Tema indisponível.');
    return state[key];
  });
  ctx.handle('installTheme', async ({ key }) => {
    if (Object.hasOwn(state, key)) return state[key];
    const entry = (await loadIndex()).themes.find((theme) => packageKey(theme) === key);
    if (!entry) throw new Error('Tema indisponível.');
    const bytes = await readRegistry(entry.path);
    if (Object.hasOwn(state, key)) return state[key];
    if (createHash('sha256').update(bytes).digest('hex') !== entry.sha256) {
      throw new Error('A integridade do pacote não confere.');
    }
    const theme = validateTheme(JSON.parse(bytes), entry);
    return save(key, { theme, nextStep: 0, links: {} });
  });
  ctx.handle('completeStep', ({ key, stepId }) => {
    if (!Object.hasOwn(state, key)) throw new Error('Tema indisponível.');
    const record = state[key];
    if (record.theme.technique.steps[record.nextStep]?.id !== stepId) return record;
    return save(key, { ...record, nextStep: record.nextStep + 1 });
  });
  ctx.handle('linkConcept', ({ key, conceptId, nodeIds }) => {
    if (!Object.hasOwn(state, key)) throw new Error('Tema indisponível.');
    const record = state[key];
    if (!record.theme.concepts.some((concept) => concept.id === conceptId) ||
        !Array.isArray(nodeIds) || nodeIds.some((id) => typeof id !== 'string')) {
      throw new Error('Vínculo inválido.');
    }
    return save(key, { ...record, links: { ...record.links, [conceptId]: [...new Set(nodeIds)] } });
  });
}

module.exports = { activate };
