// Retrying when the network, not the database, failed.

/** True when the connection to the database failed or dropped (timeout, DNS, reset), not the query itself. */
export function isNetworkError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = (error as { code?: unknown }).code;
  if (
    typeof code === "string" &&
    /^(ETIMEDOUT|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|EPIPE|ENETUNREACH|EHOSTUNREACH)$/.test(code)
  ) {
    return true;
  }
  return /ETIMEDOUT|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|Connection terminated|timeout exceeded when trying to connect|Client has encountered a connection error/i.test(
    error.message,
  );
}

/**
 * Runs `fn`, and runs it again (up to `retries` more times, with a short growing pause) if it failed
 * with a network error. Any other error is thrown straight away. Only use this for queries that are
 * safe to repeat, because after a network failure we can't tell whether the database saw the first try.
 */
export async function retryNetworkErrors<T>(fn: () => Promise<T>, retries = 2, pauseMs = 200): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt >= retries || !isNetworkError(error)) throw error;
      await new Promise((resolve) => setTimeout(resolve, pauseMs * (attempt + 1)));
    }
  }
}
