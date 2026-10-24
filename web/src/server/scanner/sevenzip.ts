import SevenZip from "7z-wasm";
import { parseSevenZipListing, type ArchiveEntry } from "./archives";

/**
 * Lists 7z and RAR archives with 7-Zip compiled to WebAssembly (the 7z-wasm
 * package, 7-Zip 24.09, LGPL with the unRAR restriction, which only forbids
 * using its code to make a RAR compressor; we only read). Nothing has to be
 * installed, and archives (untrusted input) are parsed inside the WebAssembly
 * sandbox.
 *
 * The host file system is mounted into 7-Zip, so it reads archives from disk
 * itself, and listing reads only an archive's headers: about 1 ms, however
 * big the archive.
 */

/** Where the host's root is mounted in 7-Zip's file system. */
const HOST = "/host";

type Instance = { list: (path: string) => ArchiveEntry[] };

let instance: Promise<Instance> | null = null;

async function create(): Promise<Instance> {
  let stdout: string[] = [];
  let stderr: string[] = [];
  const module = await SevenZip({
    print: (line: string) => stdout.push(line),
    printErr: (line: string) => stderr.push(line),
  });
  module.FS.mkdir(HOST);
  module.FS.mount(module.NODEFS, { root: "/" }, HOST);

  return {
    list(path) {
      stdout = [];
      stderr = [];
      try {
        // -ba: no headers, -slt: one field per line, -bsp0: no progress
        // output, which would otherwise land in front of the first entry.
        module.callMain(["l", "-slt", "-ba", "-bsp0", HOST + path]);
      } catch (error) {
        // A missing or unreadable file makes 7-Zip exit by throwing.
        stderr.push(String(error));
      }
      const problem = stderr.map((line) => line.trim()).find((line) => /error|not archive|cannot open/i.test(line));
      if (problem) throw new Error(`7-Zip: ${problem.replace(HOST, "")}`);
      return parseSevenZipListing(stdout.join("\n"));
    },
  };
}

/** The files in a 7z or RAR archive, with sizes and CRC32s. Throws if it can't be read. */
export async function listSevenZip(path: string): Promise<ArchiveEntry[]> {
  instance ??= create();
  return (await instance).list(path);
}
