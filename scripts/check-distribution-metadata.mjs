#!/usr/bin/env node
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const server = JSON.parse(readFileSync(new URL('../server.json', import.meta.url), 'utf8'));

const errors = [];

if (server.name !== pkg.mcpName) {
  errors.push(`server.json name ${server.name} does not match package.json mcpName ${pkg.mcpName}`);
}

if (server.version !== pkg.version) {
  errors.push(`server.json version ${server.version} does not match package.json version ${pkg.version}`);
}

const npmPackages = (server.packages ?? []).filter(entry => entry.registryType === 'npm');
if (npmPackages.length === 0) {
  errors.push('server.json must declare an npm package entry');
}

for (const entry of npmPackages) {
  if (entry.identifier !== pkg.name) {
    errors.push(`server.json npm identifier ${entry.identifier} does not match package.json name ${pkg.name}`);
  }
  if (entry.version !== pkg.version) {
    errors.push(`server.json npm package version ${entry.version} does not match package.json version ${pkg.version}`);
  }
}

if (errors.length > 0) {
  console.error('Distribution metadata check failed:');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(`Distribution metadata OK: ${pkg.mcpName}@${pkg.version}`);
