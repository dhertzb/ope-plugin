const { cpSync, mkdirSync } = require('node:fs');
const { join } = require('node:path');

const output = join(__dirname, 'dist');
mkdirSync(output, { recursive: true });
for (const file of ['manifest.json', 'main.js', 'backend.cjs']) {
  cpSync(join(__dirname, 'src', file), join(output, file));
}
cpSync(join(__dirname, '../../registry'), join(output, 'registry'), { recursive: true });
