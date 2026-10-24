import { readFileSync, unlinkSync, writeFileSync } from "node:fs";

/**
 * One scan at a time, across processes: the server's scans and `bun run scan`
 * take a lock file holding their process id. A lock whose process is gone
 * (a crash, a killed terminal) is stale and taken over.
 */

export type ScanLock = { release: () => void };

export type LockResult = { lock: ScanLock } | { heldBy: number };

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: it exists but belongs to someone else.
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
};

/** Takes the scan lock at `path`, or says which process holds it. */
export function acquireScanLock(path: string): LockResult {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      writeFileSync(path, String(process.pid), { flag: "wx" });
      return {
        lock: {
          release() {
            try {
              if (readFileSync(path, "utf8").trim() === String(process.pid)) unlinkSync(path);
            } catch {}
          },
        },
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const holder = Number.parseInt(readFileSync(path, "utf8"), 10);
      if (Number.isInteger(holder) && holder > 0 && alive(holder)) return { heldBy: holder };
      // Stale: its process is gone.
      try {
        unlinkSync(path);
      } catch {}
    }
  }
  const holder = Number.parseInt(readFileSync(path, "utf8"), 10);
  return { heldBy: holder };
}
