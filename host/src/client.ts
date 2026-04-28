import { readFileSync } from 'fs';
import { join } from 'path';

const API_KEY = 'EbUnxV2CRy3jZk1kgfwaY5K1zTSlnnpx9uHS8Oth';
const BASE_URL = 'https://www.waitrose.com';
const GRAPHQL_URL = `${BASE_URL}/api/graphql-prod/graph/live`;

export class WaitroseClient {
  private accessToken = '';
  private _refreshToken = '';
  private _customerId = '';
  private _orderId = '';
  private expiresAt = 0;

  private readonly username: string;
  private readonly password: string;

  constructor() {
    const creds = JSON.parse(
      readFileSync(join(import.meta.dirname, '..', '..', 'credentials.json'), 'utf8')
    );
    this.username = creds.username;
    this.password = creds.password;
  }

  async initialize() {
    await this.login();
    this.scheduleRefresh();
    console.error(`[shopme] Direct API ready — customerId=${this._customerId}, orderId=${this._orderId}`);
  }

  private scheduleRefresh() {
    const delay = Math.max(10_000, (this.expiresAt - Date.now()) - 60_000);
    setTimeout(async () => {
      try {
        await this.refresh();
      } catch (e) {
        console.error('[shopme] Refresh failed, re-logging in:', (e as Error).message);
        try { await this.login(); } catch { /* will retry next schedule */ }
      }
      this.scheduleRefresh();
    }, delay);
  }

  private async login() {
    const data = await this.rawGql('unauthenticated', `
      mutation NewSession($input: SessionInput) {
        generateSession(session: $input) {
          accessToken refreshToken customerId customerOrderId expiresIn
          failures { type message }
        }
      }
    `, { input: { username: this.username, password: this.password, clientId: 'ANDROID_APP' } });

    const s = data.generateSession;
    if (s.failures?.length) throw new Error(s.failures.map((f: any) => f.message).join(', '));
    this.applySession(s);
  }

  private async refresh() {
    const data = await this.rawGql(this._refreshToken, `
      mutation RefreshSession($input: SessionInput) {
        generateSession(session: $input) {
          accessToken refreshToken customerId customerOrderId expiresIn
          failures { type message }
        }
      }
    `, { input: { customerId: this._customerId, clientId: 'ANDROID_APP' } });

    const s = data.generateSession;
    if (s.failures?.length) throw new Error(s.failures.map((f: any) => f.message).join(', '));
    this.applySession(s);
    console.error('[shopme] Token refreshed');
  }

  private applySession(s: any) {
    this.accessToken = s.accessToken;
    this._refreshToken = s.refreshToken;
    this._customerId = s.customerId;
    if (s.customerOrderId) this._orderId = s.customerOrderId;
    this.expiresAt = Date.now() + s.expiresIn * 1000;
  }

  private makeHeaders(token: string): Record<string, string> {
    return {
      'content-type': 'application/json',
      'x-api-key': API_KEY,
      'authorization': `Bearer ${token}`,
      'user-agent': 'Waitrose/3.9.1.14114 Android',
      'breadcrumb': 'android-grocery-app',
      'client-correlation-id': crypto.randomUUID(),
    };
  }

  private async rawGql(token: string, query: string, variables?: unknown): Promise<any> {
    const res = await fetch(GRAPHQL_URL, {
      method: 'POST',
      headers: this.makeHeaders(token),
      body: JSON.stringify({ query, variables }),
    });
    const data = await res.json() as any;
    if (data.errors?.length) throw new Error(data.errors.map((e: any) => e.message).join(', '));
    return data.data;
  }

  async gql(query: string, variables?: unknown): Promise<any> {
    return this.rawGql(this.accessToken, query, variables);
  }

  async fetch(method: string, path: string, body?: string): Promise<{ status: number; body: string }> {
    const res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: this.makeHeaders(this.accessToken),
      body: body ?? undefined,
    });
    return { status: res.status, body: await res.text() };
  }

  // Re-fetch session to pick up a new orderOrderId (e.g. after emptyTrolley)
  async syncOrderId() {
    await this.refresh();
  }

  get customerId() { return this._customerId; }
  get orderId() { return this._orderId; }
  set orderId(id: string) { this._orderId = id; }
}
