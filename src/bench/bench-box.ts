import { Files } from "@cloudflare/sandbox";
import { DurableObject } from "cloudflare:workers";

/** A Bench stops itself after this long without a request; longer than any single setup step. */
const idleMs = 45 * 60 * 1000;

/** How long a container may take to start; one restored far from its snapshot takes about 50 s. */
const bootMs = 3 * 60 * 1000;

/** How long a command may run when its caller doesn't say. */
const defaultSeconds = 120;

/**
 * Rejects once `ms` pass. `exec()` has no timeout of its own, and on a container restored in another
 * location it can hang forever even for `true`, so every call into the container is bounded.
 */
const within = <A>(ms: number, what: string, work: (signal: AbortSignal) => Promise<A>) => {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;

  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      // Kills the process if it started; aborting after it exits would raise an internal error.
      controller.abort();
      reject(new Error(`${what} got no answer from the sandbox within ${Math.round(ms / 1000)} s`));
    }, ms);
  });

  return Promise.race([work(controller.signal), deadline]).finally(() => clearTimeout(timer));
};

export type BootOptions = { snapshotId: string | null; internet: boolean };

export type ShellResult = { ms: number; exitCode: number; stdout: string; stderr: string };

/**
 * One sandbox: a container started from the Bench image or a saved snapshot. Forkin's logic drives
 * it over RPC (boot, run shell commands, snapshot, destroy); this class only wraps the container.
 */
export class BenchBox extends DurableObject<Env> {
  /** Why the container stopped, once it has; later commands fail with this instead of hanging. */
  private stopped: string | null = null;

  private get container() {
    const container = this.ctx.container;

    if (!container) throw new Error("BenchBox has no container binding");

    return container;
  }

  async boot({ snapshotId, internet }: BootOptions) {
    const started = Date.now();

    if (this.container.running) return { ms: 0 };

    this.container.start({
      ...(snapshotId
        ? { containerSnapshot: { id: snapshotId } }
        : { image: this.container.images.box }),
      entrypoint: ["sleep", "infinity"],
      instance: "standard-4",
      enableInternet: internet,
    });
    await this.container.setInactivityTimeout(idleMs);
    this.stopped = null;
    // Learns when the container exits, whether it finished, crashed, or ran out of memory.
    this.container.monitor().then(
      () => (this.stopped = "The sandbox exited"),
      (cause) => (this.stopped = `The sandbox crashed: ${String(cause)}`),
    );

    // exec waits for a container that is still starting, so one bounded `true` means it's up.
    await within(bootMs, "Starting", async (signal) =>
      (await this.container.exec(["true"], { signal })).output(),
    );

    return { ms: Date.now() - started };
  }

  /** Runs a bash command, killed with everything it started after `seconds`. */
  async sh(cmd: string, seconds = defaultSeconds): Promise<ShellResult> {
    if (this.stopped) throw new Error(this.stopped);

    const started = Date.now();

    // `timeout` stops the command's whole process group; the deadline catches an exec that hangs.
    const output = await within((seconds + 30) * 1000, "A command", async (signal) =>
      (
        await this.container.exec(
          ["timeout", "--kill-after=10", String(seconds), "bash", "-lc", cmd],
          { cwd: "/workspace", signal },
        )
      ).output(),
    );

    const decoder = new TextDecoder();

    return {
      ms: Date.now() - started,
      exitCode: output.exitCode,
      stdout: decoder.decode(output.stdout),
      stderr: decoder.decode(output.stderr).slice(-20_000),
    };
  }

  /** Writes a file into the sandbox, creating its folder. */
  async writeFile(path: string, content: string) {
    const files = new Files(this.container);

    await within(defaultSeconds * 1000, "Writing a file", async () => {
      await files.mkdir(path.slice(0, path.lastIndexOf("/")), { recursive: true });
      await files.writeFile(path, content);
    });
  }

  async snapshot(name: string) {
    const snapshot = await this.container.snapshotContainer({ name });

    return { id: snapshot.id };
  }

  async destroy() {
    if (this.container.running) await within(30_000, "Stopping", () => this.container.destroy());
  }
}
