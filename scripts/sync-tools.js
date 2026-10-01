// Regenerate tools.json from src/tools.js so the spec never drifts.
// Usage: npm run tools:sync
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TOOL_SPECS } from '../src/tools.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const out = {
  server: 'freshdesk-connector',
  transport: 'stdio',
  readOnly: true,
  tools: TOOL_SPECS.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputJsonSchema,
    exampleCall: t.exampleCall,
    exampleResponse: t.exampleResponse,
  })),
};
fs.writeFileSync(path.join(__dirname, '..', 'tools.json'), `${JSON.stringify(out, null, 2)}\n`);
console.error('[tools:sync] tools.json updated.');
