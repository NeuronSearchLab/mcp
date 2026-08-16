#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import Ajv from 'ajv';
import Ajv2020 from 'ajv/dist/2020.js';

const SERVER_SCHEMA_ID = 'https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json';
const CHATGPT_SUBMISSION_SCHEMA_ID = 'https://developers.openai.com/plugins/schemas/chatgpt-app-submission.v1.json';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const server = JSON.parse(readFileSync(new URL('../server.json', import.meta.url), 'utf8'));
const submission = JSON.parse(readFileSync(new URL('../chatgpt-app-submission.json', import.meta.url), 'utf8'));

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

if (server.$schema !== SERVER_SCHEMA_ID) {
  errors.push(`server.json $schema must use the current canonical ID ${SERVER_SCHEMA_ID}`);
}

if (submission.$schema !== CHATGPT_SUBMISSION_SCHEMA_ID) {
  errors.push(`chatgpt-app-submission.json $schema must use the canonical ID ${CHATGPT_SUBMISSION_SCHEMA_ID}`);
}

async function validateAgainstLiveSchema(name, document, schemaId) {
  try {
    const response = await fetch(schemaId, { headers: { Accept: 'application/schema+json, application/json' } });
    if (!response.ok) {
      errors.push(`${name}: failed to fetch live schema ${schemaId} (HTTP ${response.status})`);
      return;
    }

    const schema = await response.json();
    if (schema?.$id !== schemaId) {
      errors.push(`${name}: live schema $id ${schema?.$id ?? '<missing>'} does not match ${schemaId}`);
      return;
    }

    const AjvClass = schema.$schema?.includes('2020-12') ? Ajv2020 : Ajv;
    const ajv = new AjvClass({ allErrors: true, strict: false, validateFormats: false });
    const validate = ajv.compile(schema);
    if (!validate(document)) {
      for (const error of validate.errors ?? []) {
        errors.push(`${name}${error.instancePath || '/'} ${error.message}`);
      }
    }
  } catch (error) {
    errors.push(`${name}: live schema validation failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

await Promise.all([
  validateAgainstLiveSchema('server.json', server, SERVER_SCHEMA_ID),
  validateAgainstLiveSchema('chatgpt-app-submission.json', submission, CHATGPT_SUBMISSION_SCHEMA_ID),
]);

if (errors.length > 0) {
  console.error('Distribution metadata check failed:');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(`Distribution metadata and live schemas OK: ${pkg.mcpName}@${pkg.version}`);
console.log(`- server.json: ${SERVER_SCHEMA_ID}`);
console.log(`- chatgpt-app-submission.json: ${CHATGPT_SUBMISSION_SCHEMA_ID}`);
