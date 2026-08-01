/**
 * Admission control for the expensive paths.
 *
 * Nine concurrent reviewers established the failure shape precisely: every
 * /api/ask launches its own Ollama generation, Ollama serialises them, so all
 * nine divide one machine's throughput and every one of them blows its timeout
 * — eight requests, eight empty answers, and memory doubling on the way
 * (832MB → 1.6GB under eight concurrent asks, measured). Meanwhile every
 * /api/search ran a transformers.js query embedding on the main thread, which
 * is how search went from 65ms to 46 seconds while a model was thinking.
 *
 * The fix is not to make the work faster; it is to stop pretending the machine
 * can do nine of these at once. One inference runs at a time. A short queue
 * holds the next few, each with a deadline. Everyone else gets an immediate,
 * honest 503 — which a model or a person can act on — instead of a 90-second
 * wait for an empty string, which nobody can.
 *
 * Two gates, deliberately separate: the ask gate protects Ollama and the
 * CPU-heavy retrieval around it; the embed gate protects the in-process
 * embedding model. Search TRIES the embed gate and degrades to lexical-only
 * instantly when it is busy — under load, search stays at 65ms and simply
 * gets slightly less clever, which nobody notices, instead of 46s slower,
 * which everybody does.
 */

type Waiter = {
  resolve: () => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

export class Gate {
  private running = 0;
  private queue: Waiter[] = [];
  // Plain fields, not constructor parameter properties: the test scripts run
  // the real source under Node's strip-only TypeScript mode, which rejects
  // parameter properties because they are syntax with runtime semantics.
  private readonly name: string;
  private readonly limit: number;
  private readonly queueCap: number;
  private readonly queueTimeoutMs: number;

  constructor(name: string, limit: number, queueCap: number, queueTimeoutMs: number) {
    this.name = name;
    this.limit = limit;
    this.queueCap = queueCap;
    this.queueTimeoutMs = queueTimeoutMs;
  }

  /** How loaded this gate is, for status endpoints and honest error bodies. */
  status(): { running: number; queued: number } {
    return { running: this.running, queued: this.queue.length };
  }

  /**
   * Take a slot, waiting in the queue if one is not free.
   *
   * Rejects immediately when the queue is full, and rejects a queued caller
   * whose wait exceeds the deadline — a request that has already waited thirty
   * seconds is a request whose client has given up, and running it anyway
   * spends the machine on an answer nobody will read.
   */
  private acquire(): Promise<void> {
    if (this.running < this.limit) {
      this.running += 1;
      return Promise.resolve();
    }
    if (this.queue.length >= this.queueCap) {
      return Promise.reject(new GateBusyError(this.name, this.status()));
    }
    return new Promise<void>((resolve, reject) => {
      const waiter: Waiter = {
        resolve: () => {
          clearTimeout(waiter.timer);
          this.running += 1;
          resolve();
        },
        reject,
        timer: setTimeout(() => {
          const at = this.queue.indexOf(waiter);
          if (at !== -1) this.queue.splice(at, 1);
          reject(new GateBusyError(this.name, this.status(), true));
        }, this.queueTimeoutMs),
      };
      this.queue.push(waiter);
    });
  }

  private release(): void {
    this.running = Math.max(0, this.running - 1);
    const next = this.queue.shift();
    if (next) next.resolve();
  }

  /** Run `work` inside a slot. The slot is released whatever happens. */
  async run<T>(work: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await work();
    } finally {
      this.release();
    }
  }

  /**
   * Run `work` only if a slot is free RIGHT NOW; otherwise return `fallback`.
   *
   * This is the degrade path: semantic search under load becomes lexical
   * search, instantly, rather than a queue of embedding jobs behind a model
   * that is already busy.
   */
  async tryRun<T>(work: () => Promise<T>, fallback: T): Promise<T> {
    if (this.running >= this.limit) return fallback;
    return this.run(work);
  }
}

export class GateBusyError extends Error {
  public readonly load: { running: number; queued: number };
  public readonly timedOut: boolean;

  constructor(gate: string, load: { running: number; queued: number }, timedOut = false) {
    super(
      timedOut
        ? `Waited too long for the ${gate} to free up.`
        : `The ${gate} is busy (${load.running} running, ${load.queued} queued).`,
    );
    this.load = load;
    this.timedOut = timedOut;
    this.name = "GateBusyError";
  }
}

/*
 * Module-level singletons. Next bundles each route separately but they share
 * the runtime, so these are genuinely global per process — which is the whole
 * point: two routes cannot each believe they hold the only inference slot.
 *
 * One inference at a time because that is what one local Ollama actually
 * serves quickly; a queue of three because the fourth caller is better served
 * by an instant "busy" than by a 90-second wait; thirty seconds in the queue
 * because that is already longer than most clients wait for anything.
 */
export const askGate = new Gate("answer engine", 1, 3, 30_000);
export const embedGate = new Gate("embedding model", 1, 2, 5_000);

/** The standard 503 for a busy gate, honest about why and what to do. */
export function busyResponse(error: GateBusyError): Response {
  return Response.json(
    {
      busy: true,
      error:
        "Lore is answering another question right now. Local models run one at a time — " +
        "try again in a few seconds.",
      load: error.load,
    },
    { status: 503, headers: { "retry-after": "5" } },
  );
}
