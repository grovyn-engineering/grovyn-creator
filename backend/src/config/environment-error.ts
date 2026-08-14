/**
 * Deliberately its own module, with no side effects.
 *
 * `env.ts` validates the environment at import time — that is what makes a
 * misconfigured process fail before it binds a port. But it means importing
 * `env.ts` can throw, so an entry point cannot statically import anything from
 * it and still catch the failure: the throw happens while the module graph is
 * being evaluated, long before `main()` runs, and escapes as an uncaught
 * exception with a stack trace instead of the readable report.
 *
 * Keeping the error class here lets `server.ts` and `worker.ts` import it
 * statically, then load `env.ts` dynamically inside a try/catch that can
 * actually see the failure.
 */
export class EnvironmentError extends Error {
  constructor(public readonly report: string) {
    super("Invalid environment configuration");
    this.name = "EnvironmentError";
  }
}
