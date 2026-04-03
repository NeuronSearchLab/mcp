/**
 * OAuth 2.0 Client Credentials token manager.
 *
 * Fetches a short-lived access token from the NeuronSearchLab token endpoint,
 * caches it in memory, and automatically refreshes it 60 seconds before expiry.
 */
export declare class TokenManager {
    private readonly clientId;
    private readonly clientSecret;
    private readonly tokenUrl;
    private token;
    private expiresAt;
    private inflight;
    constructor(clientId: string, clientSecret: string, tokenUrl?: string);
    /** Returns a valid access token, refreshing if needed. */
    getToken(): Promise<string>;
    private refresh;
}
//# sourceMappingURL=auth.d.ts.map