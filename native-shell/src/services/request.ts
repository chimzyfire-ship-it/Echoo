export class RequestTimeoutError extends Error {
  constructor(message = 'This is taking longer than expected. Please check your connection and try again.') {
    super(message);
    this.name = 'RequestTimeoutError';
  }
}
export class OfflineError extends Error {
  constructor() { super('You’re offline. Reconnect and try again.'); this.name = 'OfflineError'; }
}
let online = true; // Unknown connectivity must not prevent a real request.
export function setRequestOnline(value: boolean) { online = value; }
export function assertOnline() { if (!online) throw new OfflineError(); }
export function assertRequestActive(signal: AbortSignal) {
  if (signal.aborted) { const error = new Error('Request cancelled.'); error.name = 'AbortError'; throw error; }
}

// One deadline covers session lookup, response headers AND the response body.
// Racing the operation also releases the UI if a native promise ignores abort.
export function runRequest<T>(operation: (signal: AbortSignal) => PromiseLike<T>, options: {
  signal?: AbortSignal; timeoutMs?: number; message?: string;
} = {}): Promise<T> {
  const controller = new AbortController();
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', cancel);
      callback();
      controller.abort();
    };
    const cancel = () => finish(() => {
      const error = new Error('Request cancelled.'); error.name = 'AbortError'; reject(error);
    });
    const timer = setTimeout(() => finish(() => reject(new RequestTimeoutError(options.message))), options.timeoutMs ?? 30000);
    options.signal?.addEventListener('abort', cancel, { once: true });
    if (options.signal?.aborted) { cancel(); return; }
    Promise.resolve().then(() => {
      assertRequestActive(controller.signal);
      return operation(controller.signal);
    }).then(value => finish(() => resolve(value)), error => finish(() => reject(error)));
  });
}

// Sign-out may interrupt a refresh holding the SDK's auth lock. Only an
// explicit local sign-out turns that cancelled refresh into a missing session.
// Ordinary offline/timeout failures never invalidate a user's credentials.
let signingOut = false;
const refreshes = new Set<AbortController>();
export function interruptSessionRefresh() {
  signingOut = true;
  refreshes.forEach(controller => controller.abort());
  return () => { signingOut = false; };
}
const endedSession = () => new Response(JSON.stringify({ code: 'refresh_token_not_found', message: 'Signed out on this device.' }), {
  status: 401, headers: { 'Content-Type': 'application/json' },
});

// Supabase reads and writes share this transport. It never retries a write.
export const fetchWithDeadline: typeof fetch = (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
  const refresh = url.includes('/auth/v1/token?grant_type=refresh_token');
  if (refresh && signingOut) return Promise.resolve(endedSession());
  const controller = new AbortController();
  const parent = init?.signal ?? (typeof Request !== 'undefined' && input instanceof Request ? input.signal : undefined);
  const cancel = () => controller.abort();
  parent?.addEventListener('abort', cancel, { once: true });
  if (parent?.aborted) cancel();
  if (refresh) refreshes.add(controller);
  return runRequest(async signal => {
    assertOnline();
    const response = await fetch(input, { ...init, signal });
    const body = await response.arrayBuffer();
    assertRequestActive(signal);
    return new Response([204, 205, 304].includes(response.status) ? null : body, {
      status: response.status, statusText: response.statusText, headers: response.headers,
    });
  }, { signal: controller.signal, timeoutMs: url.includes('/storage/v1/') ? 60000 : 30000 })
    .catch(error => { if (refresh && signingOut) return endedSession(); throw error; })
    .finally(() => { refreshes.delete(controller); parent?.removeEventListener('abort', cancel); });
};

export function retryRead(failureCount: number, error: unknown) {
  if (error instanceof RequestTimeoutError || error instanceof OfflineError || (error as { name?: string })?.name === 'AbortError') return false;
  const status = (error as { status?: number })?.status;
  return failureCount < 1 && (!status || status >= 500 || status === 408);
}
