import { deflateRawSync } from "node:zlib";

/** Test helpers: builds zip archives in memory, stored or deflated. */

export type ZipInput = { name: string; data: Uint8Array; deflate?: boolean };

export function makeZip(files: ZipInput[]): Uint8Array {
  const encoder = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const file of files) {
    const name = encoder.encode(file.name);
    const body = file.deflate ? new Uint8Array(deflateRawSync(file.data)) : file.data;
    const crc = Bun.hash.crc32(file.data) as number;
    const local = new DataView(new ArrayBuffer(30 + name.length));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x800, true);
    local.setUint16(8, file.deflate ? 8 : 0, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, body.length, true);
    local.setUint32(22, file.data.length, true);
    local.setUint16(26, name.length, true);
    new Uint8Array(local.buffer).set(name, 30);
    locals.push(new Uint8Array(local.buffer), body);

    const central = new DataView(new ArrayBuffer(46 + name.length));
    central.setUint32(0, 0x02014b50, true);
    central.setUint16(4, 20, true);
    central.setUint16(6, 20, true);
    central.setUint16(8, 0x800, true);
    central.setUint16(10, file.deflate ? 8 : 0, true);
    central.setUint32(16, crc, true);
    central.setUint32(20, body.length, true);
    central.setUint32(24, file.data.length, true);
    central.setUint16(28, name.length, true);
    central.setUint32(42, offset, true);
    new Uint8Array(central.buffer).set(name, 46);
    centrals.push(new Uint8Array(central.buffer));
    offset += 30 + name.length + body.length;
  }
  const directorySize = centrals.reduce((total, part) => total + part.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, directorySize, true);
  end.setUint32(16, offset, true);
  return new Uint8Array(Buffer.concat([...locals, ...centrals, new Uint8Array(end.buffer)]));
}

/** Deterministic bytes standing in for a ROM. */
export function fakeRom(seed: number, size: number): Uint8Array {
  const bytes = new Uint8Array(size);
  let state = seed;
  for (let i = 0; i < size; i++) {
    state = (state * 1103515245 + 12345) >>> 0;
    bytes[i] = state >>> 24;
  }
  return bytes;
}

/**
 * A RAR5 archive holding one 1200-byte file, test.bin (CRC32 7CCA70CD).
 * It's test_read_format_rar5_compressed.rar from libarchive's test suite
 * (https://github.com/libarchive/libarchive, BSD 2-clause, Copyright Tim
 * Kientzle), since nothing here can create RAR archives.
 */
export const RAR5_SAMPLE = {
  bytes: Uint8Array.from(Buffer.from(
    "UmFyIRoHAQDz4YLrCwEFBwAGAQGAgIAAicZf2iYCAwvpAgSwCaSDAs1wynyABQEIdGVzdC5iaW4KAxOLV6xb+BitHsr0ZQEnZWBUH1V2Xb+UknHJz2WWWQxw2WWTGMWSE4ZCSSThkJCSSSQk45JJIQhJJCEJJJCSSEISEs21b3t9Mw6AfR0Drj+eup/3Qf732vfdea86X+gAQAEAyCCfn49vX08vHv7uzr6uno5+Xk4+Lh4N/d3NrZ19bV1NPS0M/NzMrJyMfGxcTDwb+9vLu5uLe2tbSzsrGvrq2rqqmnpaSjoqGgn52cm5mXlpSTSyUjIR6FAfjoyKiYc6cNmoaEgoB+fHt6eHZ0c3Jxb21raWdlY2FfXVtZV1VTITf1/I/QJT6JTn+ESXRYowZ5YXajgppimUF+ZC0XadRjLDOMCoR/+glMZpCl9lUKxWVguLAZFoNy4HdeEGwA8xBIyCeZhWNAumoZbYN5uHg4Bgcg+uYROgpnYYDwNt6Hu9h1fQjfxYQI0YMecKHk0Jg2L44OY6HCIEqeGFFjtjQ/nxUIBsIQ0IhNIxnJAvJQAdd1ZRAwUEAA==",
    "base64",
  )),
  entry: "test.bin",
  size: 1200,
  crc32: 0x7cca70cd,
};

/** Writes a 7z archive of `files` (paths) to `archive`, with 7-Zip itself. */
export async function makeSevenZip(archive: string, files: string[]): Promise<void> {
  const { default: SevenZip } = await import("7z-wasm");
  const errors: string[] = [];
  const module = await SevenZip({ print: () => {}, printErr: (line: string) => errors.push(line) });
  module.FS.mkdir("/host");
  module.FS.mount(module.NODEFS, { root: "/" }, "/host");
  module.callMain(["a", "-bd", "-bsp0", "/host" + archive, ...files.map((file) => "/host" + file)]);
  if (errors.some((line) => /error/i.test(line))) throw new Error(errors.join("\n"));
}
