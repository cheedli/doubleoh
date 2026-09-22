/**
 * The DoubleOh client, for an agent that would rather learn than fail twice.
 *
 * The whole SDK is three calls, because the product is three moments: before you try something, ask
 * what has been learned (`skillsFor`); when you get stuck, ask a human (`requestFix`); when you want
 * to know how that went, look (`intervention`). Everything else an integrator writes — the retry
 * loop, the "am I stuck" heuristic — is theirs, because only they know what stuck looks like for
 * their agent.
 *
 * No dependencies. It is `fetch` and types. A reliability tool that drags a tree of its own into a
 * customer's build is a reliability problem, so this stays something they can read in one sitting.
 */

export type DoubleOhOptions = {
  /** The key from your DoubleOh dashboard. Starts `oo_live_`. */
  apiKey: string;
  /** Where your DoubleOh lives. Defaults to the hosted service. */
  baseUrl?: string;
  /** Swap in for tests, or for a runtime whose global fetch you do not trust. */
  fetch?: typeof fetch;
};

/** A procedure learned from a past human fix, ready to hand to your agent. */
export type LearnedSkill = {
  name: string;
  description: string;
  /** The steps, as prose. Put this in your agent's context before it tries the task. */
  instructions: string;
  /**
   * How many agents followed this and reported it worked, and how many reported it did not.
   *
   * Raw counts rather than a rate, because they answer a question a rate cannot: 5/5 is worth
   * following, 1/1 is a guess that happened to work once. Use it to decide whether to follow a skill
   * or go straight to a human — and call `reportSkill` afterwards so the numbers mean something.
   */
  timesWorked: number;
  timesFailed: number;
  /** The edge of the skill's authority: what still needs a person, what the agent must never do. */
  authority?: { requiresHuman: string[]; never: string[] } | null;
  /** The skill as one block of context for a model, boundary first. Paste it verbatim. */
  systemHint?: string;
};

export type Intervention = {
  /** Null when the request was deflected: no intervention was opened because a skill already answers it. */
  id: string | null;
  /**
   * The link a human opens to fix it. Send this to wherever your team watches.
   *
   * **Null when this was already open.** An agent that retries asks for help on every attempt, so
   * asking twice about the same page and task returns the FIRST intervention rather than opening
   * another — one stuck task should not become ten Slack messages. The original link is still valid;
   * it cannot be reproduced here because the token is stored hashed.
   */
  fixUrl: string | null;
  /** Whether we could pre-open the stuck page for them. Informational; they can navigate anyway. */
  prepared: boolean;
  /** Set when this request matched an intervention that was already waiting. */
  duplicateOf?: string;
  /** When the original was opened, if this is a duplicate. */
  waitingSince?: string;
  /** On a duplicate: how many runs are now blocked on this wall, including yours. Triage by it. */
  blockedRuns?: number;
  /**
   * True when no human was paged because a learned skill already answers this wall.
   *
   * `skill` carries the procedure — retry with its instructions in your agent's context. If that
   * still fails, call `requestFix` again: the same wall deflects only once, so the second ask reaches
   * a human. Report the outcome either way (`reportSkill`), because deflection runs on those numbers.
   */
  deflected?: boolean;
  /** The skill that answered instead of a human, when `deflected` is true. */
  skill?: LearnedSkill;
  /** Stable id of this wall (key, site, task words). Retries and rephrasings share it. */
  wallId?: string;
  /** GET it: holds up to 55 seconds and returns when the status changes. */
  waitUrl?: string;
  /** Typical time for a person to reach the fix. A planning number. */
  expectedSeconds?: number;
  /** The next move, written for the program reading it. */
  next?: string;
};

export type InterventionStatus = {
  id: string;
  url: string;
  task: string;
  /** `open`, `resolved`, `abandoned`, `expired`. */
  status: string;
  /** The skill this fix produced, once it has. Null until then, or if nothing was learned. */
  skillName: string | null;
  /** How many runs hit this wall while it was open. The triage number: fix the biggest first. */
  blockedRuns: number;
  createdAt: string;
  /** Present while still open: the URL to wait on. */
  waitUrl?: string;
  /** The next move, written for the program reading it. */
  next?: string;
};

export class DoubleOhError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** A stable code: key_required, rate_limited, bad_request, target_refused, computer_required, quota_exceeded, not_found, unavailable. */
    readonly code?: string,
    /** What to do about it, written for the program reading it. */
    readonly next?: string,
  ) {
    super(message);
    this.name = "DoubleOhError";
  }
}

export class DoubleOh {
  readonly #apiKey: string;
  readonly #baseUrl: string;
  readonly #fetch: typeof fetch;

  constructor(options: DoubleOhOptions) {
    if (!options.apiKey?.startsWith("oo_")) {
      throw new Error("A DoubleOh API key is required (it starts with oo_).");
    }
    this.#apiKey = options.apiKey;
    this.#baseUrl = (options.baseUrl ?? "https://api.doubleoh.ai").replace(
      /\/+$/,
      "",
    );
    this.#fetch = options.fetch ?? fetch;
  }

  /**
   * What has been learned that helps with this task.
   *
   * Call this BEFORE your agent attempts something it has failed at before. If a skill comes back,
   * put its `instructions` in the agent's context — that is the whole point of the loop, the moment a
   * past human's fix saves this run from getting stuck.
   */
  async skillsFor(
    task: string,
    options: { url?: string } = {},
  ): Promise<LearnedSkill[]> {
    // The page's host scopes the answer: skills are learned per site, and a fix from one site
    // must not answer another. Pass the url whenever you have it.
    const query =
      `task=${encodeURIComponent(task)}` +
      (options.url ? `&url=${encodeURIComponent(options.url)}` : "");
    const body = await this.#get<{ skills: LearnedSkill[] }>(
      `/v1/skills?${query}`,
    );
    return body.skills;
  }

  /**
   * Ask a human to finish what your agent could not.
   *
   * Returns a fix link. Send it wherever your team lives — the human drives the page, and when they
   * mark it fixed, their actions compile into a skill `skillsFor` will return next time. You do not
   * poll this to completion unless you want to; the value arrives on the NEXT run, from the skill.
   */
  async requestFix(input: {
    /** The page your agent was stuck on. Must be a public http(s) page. */
    url: string;
    /**
     * What it was trying to do, in a sentence (max 500 characters). This is what the human is told,
     * what the compiler reads, and part of the resulting skill's identity — so phrase it the same way
     * each time and repeated fixes of one wall stay one skill.
     */
    task: string;
  }): Promise<Intervention> {
    const body = await this.#post<{ intervention: Intervention }>(
      "/v1/interventions",
      input,
    );
    return body.intervention;
  }

  /**
   * How one fix is going, and, once resolved, the skill it produced.
   *
   * With `waitSeconds` the server holds the request up to that long (55 at most) and answers as soon
   * as the status changes: one call instead of a polling loop.
   */
  async intervention(
    id: string,
    options: { waitSeconds?: number } = {},
  ): Promise<InterventionStatus> {
    const wait = Math.min(
      Math.max(0, Math.floor(options.waitSeconds ?? 0)),
      55,
    );
    const body = await this.#get<{ intervention: InterventionStatus }>(
      `/v1/interventions/${encodeURIComponent(id)}${wait ? `?wait=${wait}` : ""}`,
    );
    return body.intervention;
  }

  /**
   * Wait until a person has finished, or the deadline passes. Each round trip holds up to 55 seconds
   * on the server, so a ten-minute wait is about eleven calls, not three hundred.
   */
  async waitForFix(
    id: string,
    options: { timeoutMs?: number } = {},
  ): Promise<InterventionStatus> {
    const deadline = Date.now() + (options.timeoutMs ?? 10 * 60_000);
    let status = await this.intervention(id, { waitSeconds: 55 });
    while (status.status === "open" && Date.now() < deadline) {
      status = await this.intervention(id, { waitSeconds: 55 });
    }
    return status;
  }

  /**
   * Say whether a skill worked.
   *
   * This closes the loop, and it is the one call people will be tempted to skip. Without it a skill
   * compiled from a single recording is served forever with nothing checking it — which is exactly the
   * failure mode teams describe: an answer that is well-formed, plausible, and wrong, with nothing
   * crashing to say so.
   *
   * One boolean, so it costs nothing to wire into whatever already tells you a run succeeded. A skill
   * followed three times that never works retires itself.
   */
  async reportSkill(name: string, worked: boolean): Promise<void> {
    await this.#post(`/v1/skills/${encodeURIComponent(name)}/outcome`, {
      worked,
    });
  }

  /**
   * Stop serving a skill that made things worse.
   *
   * Call it when a learned procedure turns out to be wrong — your agents stop being told about it
   * immediately. Worth wiring to whatever signal tells you a run went badly, so a bad compile costs
   * one failure rather than every future one.
   */
  async retireSkill(name: string, reason: string): Promise<void> {
    await this.#post(`/v1/skills/${encodeURIComponent(name)}/retire`, {
      reason,
    });
  }

  /** Recent fixes across your fleet, newest first. */
  async interventions(): Promise<InterventionStatus[]> {
    const body = await this.#get<{ interventions: InterventionStatus[] }>(
      "/v1/interventions",
    );
    return body.interventions;
  }

  async #get<T>(path: string): Promise<T> {
    return this.#request<T>(path, { method: "GET" });
  }

  async #post<T>(path: string, payload: unknown): Promise<T> {
    return this.#request<T>(path, {
      method: "POST",
      body: JSON.stringify(payload),
      headers: { "content-type": "application/json" },
    });
  }

  async #request<T>(path: string, init: RequestInit): Promise<T> {
    const response = await this.#fetch(`${this.#baseUrl}${path}`, {
      ...init,
      headers: { ...init.headers, "x-api-key": this.#apiKey },
    });
    if (!response.ok) {
      // The server's own message names what went wrong; the status is the fallback.
      const detail = (await response.json().catch(() => null)) as {
        error?: string;
        code?: string;
        next?: string;
      } | null;
      throw new DoubleOhError(
        detail?.error ?? `DoubleOh answered ${response.status}`,
        response.status,
        typeof detail?.code === "string" ? detail.code : undefined,
        typeof detail?.next === "string" ? detail.next : undefined,
      );
    }
    return (await response.json()) as T;
  }
}
