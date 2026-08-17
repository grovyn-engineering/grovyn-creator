#!/usr/bin/env node
/**
 * Frees the dev ports.
 *
 * `npm run dev` starts two servers under `concurrently`. If that process is
 * killed in a way that does not let it clean up — a terminal window closed, a
 * hard stop from an editor, a crash — the child servers survive and keep
 * holding 3000 and 5000. The next `npm run dev` then fails with EADDRINUSE,
 * and because the root script uses `--kill-others-on-fail`, one stuck port
 * takes both apps down. The reported exit codes (1, or 4294967295 on Windows)
 * say nothing about the actual cause.
 *
 * This is deliberately a separate command rather than a `predev` hook: killing
 * whatever happens to hold a port is too blunt to do automatically. Something
 * else of yours could legitimately be on 3000.
 *
 *   npm run ports:free
 */
import { execSync } from "node:child_process";
import { createServer } from "node:net";

const PORTS = [3000, 5000];
const isWindows = process.platform === "win32";

function inUse(port) {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", (err) => resolve(err.code === "EADDRINUSE"));
    server.once("listening", () => server.close(() => resolve(false)));
    server.listen(port, "127.0.0.1");
  });
}

/** PIDs listening on a port. Returns [] rather than throwing when none match. */
function listenersOn(port) {
  try {
    if (isWindows) {
      const out = execSync(`netstat -ano -p TCP | findstr LISTENING | findstr :${port}`, {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      });
      return [
        ...new Set(
          out
            .split("\n")
            .map((line) => line.trim().split(/\s+/).pop())
            .filter((pid) => pid && /^\d+$/.test(pid) && pid !== "0")
        ),
      ];
    }

    const out = execSync(`lsof -ti tcp:${port} -s tcp:LISTEN`, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return out.split("\n").map((s) => s.trim()).filter(Boolean);
  } catch {
    // Both commands exit non-zero when nothing matches.
    return [];
  }
}

function kill(pid) {
  try {
    execSync(isWindows ? `taskkill /F /PID ${pid}` : `kill -9 ${pid}`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

let freed = 0;

for (const port of PORTS) {
  if (!(await inUse(port))) {
    console.log(`  port ${port}  free`);
    continue;
  }

  const pids = listenersOn(port);
  if (pids.length === 0) {
    console.log(`  port ${port}  in use, but the owning process could not be identified`);
    continue;
  }

  for (const pid of pids) {
    console.log(`  port ${port}  ${kill(pid) ? "killed" : "could not kill"} pid ${pid}`);
  }
  freed += 1;
}

console.log(freed > 0 ? "\nPorts freed. Run `npm run dev`." : "\nNothing to free.");
