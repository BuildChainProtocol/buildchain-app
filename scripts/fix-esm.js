#!/usr/bin/env node
/**
 * fix-esm.js — run via postinstall after patch-package
 *
 * @noble/hashes v2.x is pure ESM and cannot be require()'d from CJS bundles
 * (which is what Vercel serverless uses for Next.js API routes).
 *
 * patch-package handles shared.js; this script handles any additional files
 * that need the same treatment but are harder to express in patch format.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

const fixes = [
  {
    file: 'node_modules/@xrplf/isomorphic/dist/internal/normalizeInput.js',
    find: 'const utils_js_1 = require("@noble/hashes/utils.js");',
    replace: [
      '// fix-esm: inline utf8ToBytes — @noble/hashes v2 is pure ESM',
      'const utils_js_1 = { utf8ToBytes: (str) => new TextEncoder().encode(str) };',
    ].join('\n'),
  },
];

let anyChanged = false;

for (const { file, find, replace } of fixes) {
  const filePath = path.join(ROOT, file);

  if (!fs.existsSync(filePath)) {
    console.log(`fix-esm: skip (not found) ${file}`);
    continue;
  }

  const content = fs.readFileSync(filePath, 'utf8');

  if (!content.includes(find)) {
    // Either already patched or the package changed — either way, nothing to do
    console.log(`fix-esm: already patched or pattern not found — ${file}`);
    continue;
  }

  fs.writeFileSync(filePath, content.replace(find, replace), 'utf8');
  console.log(`fix-esm: patched ${file}`);
  anyChanged = true;
}

if (!anyChanged) {
  console.log('fix-esm: nothing to do');
}
