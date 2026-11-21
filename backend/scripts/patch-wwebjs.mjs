import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(__dirname, '..');
const utilsPath = path.join(backendRoot, 'node_modules/whatsapp-web.js/src/util/Injected/Utils.js');

const MARKER = '__WWEBJS_SERIALIZED_KEY_PATCH__';

if (!fs.existsSync(utilsPath)) {
  console.log('[patch-wwebjs] Utils.js not found, skipping:', utilsPath);
  process.exit(0);
}

const content = fs.readFileSync(utilsPath, 'utf8');
if (content.includes(MARKER)) {
  console.log('[patch-wwebjs] Utils.js already patched.');
  process.exit(0);
}

const targetSnippet = `        if (typeof msg.id.remote === 'object') {
            msg.id = Object.assign({}, msg.id, {
                remote: msg.id.remote._serialized,
            });
        }`;

const targetCrlf = targetSnippet.replace(/\n/g, '\r\n');
const eol = content.includes(targetCrlf) ? '\r\n' : '\n';
const matched = content.includes(targetSnippet) ? targetSnippet : (content.includes(targetCrlf) ? targetCrlf : null);

if (!matched) {
  console.log('[patch-wwebjs] Target snippet not found (whatsapp-web.js version may differ); relying on runtime page patch.');
  process.exit(0);
}

const replacementLines = [
  `        // ${MARKER}: preserve _serialized & normalize participant alongside remote`,
  `        if (msg.id) {`,
  `            const _remoteStr = typeof msg.id.remote === 'object' ? msg.id.remote?._serialized : msg.id.remote;`,
  `            const _partStr = typeof msg.id.participant === 'object' ? msg.id.participant?._serialized : msg.id.participant;`,
  `            const _serialized =`,
  `                (typeof msg.id._serialized === 'string' && msg.id._serialized && msg.id._serialized !== 'undefined' ? msg.id._serialized : null) ||`,
  `                (typeof msg.id.fromMe === 'boolean' && _remoteStr && msg.id.id`,
  `                    ? \`\${msg.id.fromMe}_\${_remoteStr}_\${msg.id.id}\${_partStr ? \`_\${_partStr}\` : ''}\``,
  `                    : undefined);`,
  `            if (typeof msg.id.remote === 'object' || typeof msg.id.participant === 'object' || !msg.id._serialized || msg.id._serialized === 'undefined') {`,
  `                msg.id = Object.assign({}, msg.id, {`,
  `                    remote: _remoteStr,`,
  `                    ...(_partStr !== undefined ? { participant: _partStr } : {}),`,
  `                    ...(_serialized ? { _serialized } : {}),`,
  `                });`,
  `            }`,
  `        }`,
];

const patched = content.replace(matched, replacementLines.join(eol));
fs.writeFileSync(utilsPath, patched, 'utf8');
console.log('[patch-wwebjs] Successfully patched whatsapp-web.js Utils.js.');

