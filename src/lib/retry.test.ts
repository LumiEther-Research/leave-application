// Run with `npm test`. Retrying reads when the network fails, without a database.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { isNetworkError, retryNetworkErrors } from "./retry";

const networkError = () => Object.assign(new Error("connect ETIMEDOUT 10.0.0.1:5432"), { code: "ETIMEDOUT" });

describe("network errors", () => {
  test("a timeout, a reset, a dropped or unreachable connection are network errors; a database error is not", () => {
    assert.equal(isNetworkError(networkError()), true);
    assert.equal(isNetworkError(new Error("read ECONNRESET")), true);
    assert.equal(isNetworkError(new Error("Connection terminated unexpectedly")), true);
    assert.equal(isNetworkError(new Error("timeout exceeded when trying to connect")), true);
    assert.equal(isNetworkError(Object.assign(new Error("getaddrinfo"), { code: "ENOTFOUND" })), true);
    assert.equal(isNetworkError(new Error('duplicate key value violates unique constraint "admins_email_key"')), false);
    assert.equal(isNetworkError(new Error("password authentication failed for user")), false);
    assert.equal(isNetworkError("ETIMEDOUT"), false); // not an Error
    assert.equal(isNetworkError(Object.assign(new Error("duplicate key"), { code: "23505" })), false);
  });
});

describe("retrying", () => {
  test("returns the first success without retrying", async () => {
    let calls = 0;
    assert.equal(await retryNetworkErrors(async () => (++calls, "ok"), 2, 1), "ok");
    assert.equal(calls, 1);
  });

  test("tries again after a network error and returns the later success", async () => {
    let calls = 0;
    const result = await retryNetworkErrors(
      async () => {
        if (++calls < 3) throw networkError();
        return "recovered";
      },
      2,
      1,
    );
    assert.deepEqual([result, calls], ["recovered", 3]);
  });

  test("gives up after the retries and throws the network error", async () => {
    let calls = 0;
    await assert.rejects(
      retryNetworkErrors(async () => (++calls, Promise.reject(networkError())), 2, 1),
      /ETIMEDOUT/,
    );
    assert.equal(calls, 3); // the first try and two retries
  });

  test("never retries a database error", async () => {
    let calls = 0;
    await assert.rejects(
      retryNetworkErrors(async () => (++calls, Promise.reject(new Error("syntax error"))), 2, 1),
      /syntax error/,
    );
    assert.equal(calls, 1);
  });
});
