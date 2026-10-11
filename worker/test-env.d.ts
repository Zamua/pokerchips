import type { Env as WorkerEnv } from './env.js';

declare global {
  namespace Cloudflare {
    interface Env extends WorkerEnv {}
  }
}
