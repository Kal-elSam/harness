const DEFAULT_TIMEOUT_MS = 5000;

export async function fetchJson(url, {
  method = "GET",
  headers = {},
  body = null,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  fetchImpl = globalThis.fetch
} = {}) {
  if (typeof fetchImpl !== "function") {
    return {
      ok: false,
      status: 0,
      data: null,
      error: "fetch is not available in this runtime"
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(url, {
      method,
      headers,
      body: body == null ? undefined : JSON.stringify(body),
      signal: controller.signal
    });

    const text = await response.text();
    let data = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = { raw: text };
      }
    }

    return {
      ok: response.ok,
      status: response.status,
      data,
      error: response.ok ? null : summarizeHttpError(response.status, data, text)
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      data: null,
      error: error?.name === "AbortError" ? "request timed out" : (error?.message ?? String(error))
    };
  } finally {
    clearTimeout(timer);
  }
}

function summarizeHttpError(status, data, text) {
  if (data?.error?.message) return data.error.message;
  if (typeof data?.error === "string") return data.error;
  if (text) return text.slice(0, 200);
  return `HTTP ${status}`;
}
