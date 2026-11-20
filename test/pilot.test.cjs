const assert = require('node:assert/strict');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { test } = require('node:test');

test('installs, studies in sequence and reopens the pilot without losing links', async (t) => {
  const { activate } = require('../dist/backend.cjs');
  const dataDirectory = mkdtempSync(join(tmpdir(), 'ope-pilot-'));
  t.after(() => rmSync(dataDirectory, { recursive: true, force: true }));

  function start() {
    const handlers = new Map();
    activate({ dataDirectory, handle: (name, handler) => handlers.set(name, handler) });
    return (name, args) => handlers.get(name)(args);
  }

  const call = start();
  const { themes } = await call('catalog');
  const key = `${themes[0].id}@${themes[0].version}`;
  const installed = await call('installTheme', { key });
  assert.equal(installed.theme.technique.steps.length, 3);
  assert.equal(call('completeStep', { key, stepId: 'apply' }).nextStep, 0);
  call('completeStep', { key, stepId: 'recall' });
  call('linkConcept', { key, conceptId: 'closure', nodeIds: ['native-node'] });
  assert.equal((await call('installTheme', { key })).nextStep, 1);
  const reopened = start()('openTheme', { key });
  assert.equal(reopened.nextStep, 1);
  assert.deepEqual(reopened.links.closure, ['native-node']);
  assert.deepEqual(reopened.theme.concepts[1].prerequisites, ['scope']);
});
