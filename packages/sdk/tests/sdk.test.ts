import { describe, expect, test } from "bun:test";
import { DoubleOh, DoubleOhError } from "../src/index";

/**
 * The SDK's contract with the people integrating it.
 *
 * What is worth pinning here is not that fetch works — it is the promises the README makes: the key
 * travels on every request, the envelope is unwrapped so callers never see `{ skills: … }`, a bad
 * key is refused before a request is spent, and a server error arrives as a message a developer can
 * act on rather than a status code they have to look up.
 */

function stub(
  handler: (
    url: string,
    init: RequestInit,
  ) => { status?: number; body: unknown },
) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl = (async (
    url: string | URL | Request,
    init: RequestInit = {},
  ) => {
    calls.push({ url: String(url), init });
    const { status = 200, body } = handler(String(url), init);
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

const KEY = "oo_live_testkey";

describe("the DoubleOh client", () => {
  test("refuses a key that is not one, before spending a request", () => {
    expect(() => new DoubleOh({ apiKey: "" })).toThrow(/API key/);
    expect(() => new DoubleOh({ apiKey: "sk-not-ours" })).toThrow(/oo_/);
  });

  test("sends the key on every request", async () => {
    const { fetchImpl, calls } = stub(() => ({ body: { skills: [] } }));
    await new DoubleOh({
      apiKey: KEY,
      baseUrl: "https://api.test",
      fetch: fetchImpl,
    }).skillsFor("anything");

    expect(calls[0]?.init.headers).toMatchObject({ "x-api-key": KEY });
  });

  test("skillsFor unwraps the envelope and encodes the task", async () => {
    const { fetchImpl, calls } = stub(() => ({
      body: {
        skills: [
          {
            name: "dismiss-the-banner",
            description: "when a banner blocks checkout",
            instructions: "1. Click Accept.",
          },
        ],
      },
    }));
    const skills = await new DoubleOh({
      apiKey: KEY,
      baseUrl: "https://api.test",
      fetch: fetchImpl,
    }).skillsFor("check out & pay");

    // The caller gets the array, never the wrapper.
    expect(skills[0]?.instructions).toBe("1. Click Accept.");
    // And a task with spaces and an ampersand survives the trip.
    expect(calls[0]?.url).toContain("task=check%20out%20%26%20pay");
  });

  test("waitForFix holds on the server and returns when the status changes", async () => {
    let calls = 0;
    const { fetchImpl, calls: seen } = stub(() => {
      calls += 1;
      return {
        body: {
          intervention: {
            id: "i1",
            url: "https://shop.example",
            task: "t",
            status: calls < 2 ? "open" : "resolved",
            skillName: calls < 2 ? null : "checkout-finish-1a2b3c",
            blockedRuns: 1,
            createdAt: "2026-09-16T00:00:00Z",
          },
        },
      };
    });
    const oo = new DoubleOh({
      apiKey: KEY,
      baseUrl: "https://api.test",
      fetch: fetchImpl,
    });
    const done = await oo.waitForFix("i1");
    expect(done.status).toBe("resolved");
    expect(done.skillName).toBe("checkout-finish-1a2b3c");
    expect(seen.map((c) => c.url)).toEqual([
      "https://api.test/v1/interventions/i1?wait=55",
      "https://api.test/v1/interventions/i1?wait=55",
    ]);
  });

  test("a refusal carries the server's code and next move", async () => {
    const { fetchImpl } = stub(() => ({
      status: 402,
      body: {
        error: "The free plan includes 5 human fixes a month.",
        code: "quota_exceeded",
        next: "Ask a person to upgrade the plan at upgradeUrl.",
      },
    }));
    const oo = new DoubleOh({
      apiKey: KEY,
      baseUrl: "https://api.test",
      fetch: fetchImpl,
    });
    try {
      await oo.requestFix({ url: "https://shop.example", task: "t" });
      throw new Error("did not throw");
    } catch (error) {
      expect(error).toBeInstanceOf(DoubleOhError);
      const refused = error as DoubleOhError;
      expect(refused.status).toBe(402);
      expect(refused.code).toBe("quota_exceeded");
      expect(refused.next).toContain("upgrade");
    }
  });

  test("skillsFor scopes the answer to the page's host when a url is given", async () => {
    const { fetchImpl, calls } = stub(() => ({ body: { skills: [] } }));
    await new DoubleOh({
      apiKey: KEY,
      baseUrl: "https://api.test",
      fetch: fetchImpl,
    }).skillsFor("check out", { url: "https://www.shop.example/cart?x=1&y=2" });
    expect(calls[0]?.url).toBe(
      "https://api.test/v1/skills?task=check%20out&url=https%3A%2F%2Fwww.shop.example%2Fcart%3Fx%3D1%26y%3D2",
    );
  });
  test("requestFix posts the task and returns the link", async () => {
    const { fetchImpl, calls } = stub(() => ({
      status: 201,
      body: {
        intervention: {
          id: "abc",
          fixUrl: "https://app.test/fix/fix_1",
          prepared: true,
        },
      },
    }));
    const fix = await new DoubleOh({
      apiKey: KEY,
      baseUrl: "https://api.test",
      fetch: fetchImpl,
    }).requestFix({ url: "https://portal.example", task: "Check out" });

    expect(fix.fixUrl).toBe("https://app.test/fix/fix_1");
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
      url: "https://portal.example",
      task: "Check out",
    });
  });

  test("a trailing slash on the base url does not double up", async () => {
    const { fetchImpl, calls } = stub(() => ({ body: { skills: [] } }));
    await new DoubleOh({
      apiKey: KEY,
      baseUrl: "https://api.test/",
      fetch: fetchImpl,
    }).skillsFor("x");
    expect(calls[0]?.url).toBe("https://api.test/v1/skills?task=x");
  });

  test("a server error arrives as its own message, with the status", async () => {
    // A developer can act on "A valid API key is required."; they cannot act on "401".
    const { fetchImpl } = stub(() => ({
      status: 401,
      body: { error: "A valid API key is required." },
    }));
    const client = new DoubleOh({
      apiKey: KEY,
      baseUrl: "https://api.test",
      fetch: fetchImpl,
    });

    expect(client.skillsFor("x")).rejects.toThrow(DoubleOhError);
    await client.skillsFor("x").catch((error: DoubleOhError) => {
      expect(error.message).toBe("A valid API key is required.");
      expect(error.status).toBe(401);
    });
  });

  test("an error with no message still names the status", async () => {
    const { fetchImpl } = stub(() => ({ status: 503, body: {} }));
    await new DoubleOh({
      apiKey: KEY,
      baseUrl: "https://api.test",
      fetch: fetchImpl,
    })
      .skillsFor("x")
      .catch((error: DoubleOhError) => {
        expect(error.message).toContain("503");
      });
  });
});
