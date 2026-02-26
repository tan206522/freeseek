/// <reference types="vite/client" />
declare module "*.vue" {
  import type { DefineComponent } from "vue";
  const component: DefineComponent<{}, {}, any>;
  export default component;
}

interface FreeSeekAPI {
  startServer(port: number): Promise<{ ok: boolean; port?: number; error?: string }>;
  stopServer(): Promise<{ ok: boolean }>;
  getServerStatus(): Promise<{
    running: boolean; port: number; hasCredentials: boolean;
    capturedAt: string | null; uptime: number;
  }>;
  getStats(): Promise<{
    requestCount: number; totalInputTokens: number;
    totalOutputTokens: number; totalTokens: number;
  }>;
  resetSessions(): Promise<{ ok: boolean }>;
  startAuth(): Promise<{ ok: boolean; capturedAt?: string; error?: string }>;
  getCredentials(): Promise<{
    hasCookie: boolean; cookieCount: number; hasBearer: boolean;
    bearerLength: number; capturedAt: string; hasSessionId: boolean;
  } | null>;
  clearCredentials(): Promise<{ ok: boolean }>;
  checkCredentialExpiry(): Promise<{
    valid: boolean; expiresAt?: string; remainingMs?: number;
    expired?: boolean; expiringSoon?: boolean; reason?: string;
  }>;
  saveManualCredentials(creds: {
    cookie: string; bearer: string; userAgent: string;
  }): Promise<{ ok: boolean; error?: string }>;
  onLog(cb: (log: { time: string; level: string; msg: string }) => void): () => void;
  onAuthStatus(cb: (msg: string) => void): () => void;
}

declare global {
  interface Window { freeseek: FreeSeekAPI; }
}
