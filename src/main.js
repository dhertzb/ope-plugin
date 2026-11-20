export function activate(ctx) {
  ctx.registerAction({
    id: 'open-library',
    name: 'Temas da comunidade',
    run: () => ctx.app.openView('library')
  });
  ctx.placeAction({ id: 'library-sidebar', actionId: 'open-library', location: 'sidebar' });
  ctx.registerView({ id: 'library', name: 'Temas da comunidade', mount });

  function mount(container, signal) {
    const view = document.createElement('section');
    container.append(view);
    const status = document.createElement('p');
    status.setAttribute('role', 'status');
    container.append(status);
    const keyFor = ({ id, version }) => `${id}@${version}`;
    let generation = 0;

    function append(parent, tag, text) {
      const element = document.createElement(tag);
      element.textContent = text;
      parent.append(element);
      return element;
    }

    async function run(work) {
      status.textContent = '';
      try {
        await work();
      } catch (error) {
        if (!signal.aborted) status.textContent = error.message;
      }
    }

    function button(parent, label, action) {
      const element = append(parent, 'button', label);
      element.type = 'button';
      element.addEventListener('click', () => run(async () => {
        element.disabled = true;
        try {
          await action();
        } finally {
          element.disabled = false;
        }
      }));
    }

    async function library() {
      const current = ++generation;
      const { themes, installed, registryError } = await ctx.call('catalog', {});
      if (signal.aborted || current !== generation) return;
      view.replaceChildren();
      status.textContent = registryError ?? '';
      const available = new Map(themes.map((theme) => [keyFor(theme), theme]));
      for (const theme of installed) available.set(keyFor(theme), theme);
      const installedKeys = new Set(installed.map(keyFor));
      const list = append(view, 'ul', '');
      for (const [key, theme] of available) {
        const row = append(list, 'li', `${theme.title} · ${theme.version} `);
        const exists = installedKeys.has(key);
        button(row, exists ? 'Abrir' : 'Instalar', async () => {
          if (!exists) await ctx.call('installTheme', { key });
          await openTheme(key);
        });
      }
    }

    async function openTheme(key) {
      const current = ++generation;
      const record = await ctx.call('openTheme', { key });
      if (signal.aborted || generation !== current) return;
      const screen = new AbortController();
      const dispose = () => screen.abort();
      signal.addEventListener('abort', dispose, { once: true, signal: screen.signal });
      cleanupScreen();
      cleanupScreen = dispose;

      const { theme, nextStep, links } = record;
      view.replaceChildren();
      button(view, 'Voltar à biblioteca', async () => {
        cleanupScreen();
        await library();
      });
      append(view, 'h2', theme.title);
      append(view, 'p', `${theme.author} · ${theme.license} · ${theme.version}`);
      append(view, 'h3', 'Conceitos e pré-requisitos');
      const conceptTitles = new Map(theme.concepts.map(({ id, title }) => [id, title]));
      const list = append(view, 'ul', '');
      for (const concept of theme.concepts) {
        const row = append(list, 'li', concept.title);
        if (concept.prerequisites.length) {
          append(row, 'p', 'Pré-requisitos: ' + concept.prerequisites.map((id) => conceptTitles.get(id)).join(', '));
        }
        const picker = ctx.ui.mountKnowledgePicker(row, {
          value: links[concept.id] ?? [],
          onChange: (nodeIds) => run(async () => {
            await ctx.call('linkConcept', { key, conceptId: concept.id, nodeIds });
            if (!screen.signal.aborted) picker.update({ value: nodeIds });
          })
        }, { signal: screen.signal });
      }

      append(view, 'h3', theme.technique.title);
      const step = theme.technique.steps[nextStep];
      if (!step) {
        append(view, 'p', 'Técnica concluída.');
        return;
      }
      append(view, 'p', `Etapa ${nextStep + 1} de ${theme.technique.steps.length} · ${conceptTitles.get(step.conceptId)}`);
      append(view, 'p', step.prompt);
      const solution = append(view, 'details', '');
      append(solution, 'summary', 'Ver resposta publicada');
      append(solution, 'p', step.answer);
      if (step.kind !== 'flashcard') {
        button(view, 'Copiar enunciado para uma sessão', () => navigator.clipboard.writeText(
          `Tema: ${theme.title} (${theme.id}@${theme.version})\n` +
          `Técnica: ${theme.technique.title}\n` +
          `Ajude-me a resolver este enunciado sem antecipar a solução.\n\n${step.prompt}`
        ));
      }
      button(view, 'Concluir etapa', async () => {
        await ctx.call('completeStep', { key, stepId: step.id });
        if (!screen.signal.aborted) await openTheme(key);
      });
    }

    let cleanupScreen = () => {};
    run(library);
    return () => {
      cleanupScreen();
      view.remove();
      status.remove();
    };
  }
}
