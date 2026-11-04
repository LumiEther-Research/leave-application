// Retrying when the network, not the database, failed.

/** True when the request never got an answer from the database (timeout, DNS, connection reset). */
export function isNetworkError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const cause = (error as { sourceError?: { message?: string } }).sourceError;
  const text = `${error.message} ${cause?.message ?? ""}`;
  return /fetch failed|Error connecting to database|ETIMEDOUT|ECONNRESET|ENOTFOUND|EAI_AGAIN|UND_ERR_CONNECT_TIMEOUT/i.test(
    text,
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
