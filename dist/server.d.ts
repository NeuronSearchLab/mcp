import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { NeuronClient } from './client.js';
export type ServerMode = 'public' | 'internal';
export declare function createServer(client: NeuronClient, mode?: ServerMode): Server;
//# sourceMappingURL=server.d.ts.map