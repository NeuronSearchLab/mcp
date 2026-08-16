#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';

const packageUrl = new URL('../package.json', import.meta.url);
const serverUrl = new URL('../server.json', import.meta.url);
const pkg = JSON.parse(readFileSync(packageUrl, 'utf8'));
const server = JSON.parse(readFileSync(serverUrl, 'utf8'));

server.version = pkg.version;
for (const entry of server.packages ?? []) {
  if (entry.registryType === 'npm' && entry.identifier === pkg.name) {
    entry.version = pkg.version;
  }
}

writeFileSync(serverUrl, `${JSON.stringify(server, null, 2)}\n`);
console.log(`Synchronized server.json to ${pkg.name}@${pkg.version}`);
