import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { NeuronClient } from './client.js';
export type ServerMode = 'public' | 'internal';
export type ToolProfile = 'default' | 'hosted';
export declare const HOSTED_PROFILE_VERSION = 1;
export declare function createServer(client: NeuronClient, mode?: ServerMode, profile?: ToolProfile): Server;
//# sourceMappingURL=server.d.ts.map