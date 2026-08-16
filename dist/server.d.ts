import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { NeuronClient } from './client.js';
export type ServerMode = 'public' | 'internal';
export type ToolProfile = 'default' | 'hosted';
export declare const HOSTED_PROFILE_VERSION = 2;
type ToolSecurityScheme = {
    type: 'oauth2';
    scopes: string[];
};
type AuthenticatedTool = Tool & {
    securitySchemes?: ToolSecurityScheme[];
};
export declare function getExportedTools(mode: ServerMode, profile: ToolProfile): AuthenticatedTool[];
export declare function createServer(client: NeuronClient, mode?: ServerMode, profile?: ToolProfile): Server;
export {};
//# sourceMappingURL=server.d.ts.map