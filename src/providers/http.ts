// Shared fetch helpers for provider adapters — normalise base URLs, retry
// flaky network errors, and surface actionable messages instead of bare
// "Failed to fetch" (the classic extension SW / CORS / bad-base-URL failure).

export function normalizeOpenAiBaseUrl(base: string): string {
  let u = (base || "").trim().replace(/\/+$/, "");
  // Users often paste …/v1 or …/v1/chat/completions from other tools.
  u = u.replace(/\/chat\/completions$/i, "");
  u = u.replace(/\/v1$/i, "");
  return u;
}

export function chatCompletionsUrl(baseUrl: string): string {
  return `${normalizeOpenAiBaseUrl(baseUrl)}/v1/chat/completions`;
}

export async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 500);
  } catch {
    return "<no body>";
  }
}

export function isNetworkError(e: unknown): boolean {
  if (e instanceof TypeError) return true;
  const msg = e instanceof Error ? e.message : String(e);
  return /failed to fetch|networkerror|load failed|network request failed/i.test(msg);
}

export function networkErrorMessage(label: string, url: string, cause: unknown): string {
  const detail = cause instanceof Error ? cause.message : String(cause);
  return (
    `${label} network error (${detail}) calling ${url}. ` +
    `Check: (1) API key in Settings, (2) model id is valid, (3) chrome://extensions → Mirage → ` +
    `site access allows this host, (4) reload the extension after rebuild. ` +
    `If using a custom base URL, omit trailing /v1.`
  );
}

/** fetch with 1 automatic retry on pure network failures (not HTTP 4xx/5xx). */
export async function fetchWithRetry(
  url: string,
  init: RequestInit,
  opts: { retries?: number; label?: string } = {},
): Promise<Response> {
  const retries = opts.retries ?? 1;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fetch(url, init);
    } catch (e) {
      lastErr = e;
      // Don't retry intentional aborts.
      if (e instanceof DOMException && e.name === "AbortError") throw e;
      const msg = e instanceof Error ? e.message : String(e);
      if (/abort/i.test(msg)) throw e;
      if (attempt < retries && isNetworkError(e)) {
        await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
        continue;
      }
      throw e;
    }
  }
  throw lastErr;
}
