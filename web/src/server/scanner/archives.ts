import { inflateRawSync } from "node:zlib";

/**
 * Lists the files in ROM archives without unpacking them: a zip's central
 * directory holds each file's size and CRC32, which is all the DAT lookup
 * needs. 7z and RAR archives are listed by 7-Zip (sevenzip.ts); this file
 * parses what it prints.
 */

export type ArchiveEntry = { name: string; size: number; crc32: number | null; offset?: number; method?: number };

const EOCD = 0x06054b50;
const ZIP64_LOCATOR = 0x07064b50;
const ZIP64_EOCD = 0x06064b50;
const CENTRAL_ENTRY = 0x02014b50;
const LOCAL_HEADER = 0x04034b50;
const MAX_U32 = 0xffffffff;

const read = async (path: string, start: number, end: number) =>
  new DataView((await Bun.file(path).slice(start, end).arrayBuffer()));

const bigint = (view: DataView, offset: number) => Number(view.getBigUint64(offset, true));

/** The files in a zip, from its central directory. Throws if it isn't a zip. */
export async function listZip(path: string): Promise<ArchiveEntry[]> {
  const size = Bun.file(path).size;
  // The end record is at most 22 bytes plus a 64 KB comment from the end.
  const tailStart = Math.max(0, size - 22 - 0xffff);
  const tail = await read(path, tailStart, size);
  let eocd = -1;
  for (let i = tail.byteLength - 22; i >= 0; i--) {
    if (tail.getUint32(i, true) === EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("not a zip file");

  let count = tail.getUint16(eocd + 10, true);
  let directorySize = tail.getUint32(eocd + 12, true);
  let directoryOffset = tail.getUint32(eocd + 16, true);
  if (count === 0xffff || directorySize === MAX_U32 || directoryOffset === MAX_U32) {
    const locator = eocd - 20;
    if (locator < 0 || tail.getUint32(locator, true) !== ZIP64_LOCATOR) throw new Error("broken zip64 file");
    const recordOffset = bigint(tail, locator + 8);
    const record = await read(path, recordOffset, recordOffset + 56);
    if (record.getUint32(0, true) !== ZIP64_EOCD) throw new Error("broken zip64 file");
    count = bigint(record, 32);
    directorySize = bigint(record, 40);
    directoryOffset = bigint(record, 48);
  }

  const directory = await read(path, directoryOffset, directoryOffset + directorySize);
  const entries: ArchiveEntry[] = [];
  for (let at = 0, i = 0; i < count && at + 46 <= directory.byteLength; i++) {
    if (directory.getUint32(at, true) !== CENTRAL_ENTRY) throw new Error("broken zip directory");
    const flags = directory.getUint16(at + 8, true);
    const method = directory.getUint16(at + 10, true);
    const crc32 = directory.getUint32(at + 16, true);
    let size = directory.getUint32(at + 24, true);
    const compressed = directory.getUint32(at + 20, true);
    const nameLength = directory.getUint16(at + 28, true);
    const extraLength = directory.getUint16(at + 30, true);
    const commentLength = directory.getUint16(at + 32, true);
    let offset = directory.getUint32(at + 42, true);
    const nameBytes = new Uint8Array(directory.buffer, directory.byteOffset + at + 46, nameLength);
    // Bit 11 marks UTF-8 names; older tools wrote the DOS code page.
    const name = new TextDecoder(flags & 0x800 ? "utf-8" : "latin1").decode(nameBytes);

    // Sizes and offsets that don't fit 32 bits are in the zip64 extra field,
    // in this order, and only those that overflowed.
    let extra = at + 46 + nameLength;
    const extraEnd = extra + extraLength;
    while (extra + 4 <= extraEnd) {
      const id = directory.getUint16(extra, true);
      const length = directory.getUint16(extra + 2, true);
      if (id === 0x0001) {
        let field = extra + 4;
        if (size === MAX_U32) (size = bigint(directory, field)), (field += 8);
        if (compressed === MAX_U32) field += 8;
        if (offset === MAX_U32) offset = bigint(directory, field);
      }
      extra += 4 + length;
    }

    if (!name.endsWith("/")) entries.push({ name, size, crc32, offset, method });
    at = extraEnd + commentLength;
  }
  return entries;
}

/** The bytes of one stored or deflated file in a zip, for the rare cases that need content. */
export async function readZipEntry(path: string, entry: ArchiveEntry): Promise<Uint8Array> {
  if (entry.offset === undefined) throw new Error("entry has no offset");
  const header = await read(path, entry.offset, entry.offset + 30);
  if (header.getUint32(0, true) !== LOCAL_HEADER) throw new Error("broken zip entry");
  const start = entry.offset + 30 + header.getUint16(26, true) + header.getUint16(28, true);
  const compressedSize = header.getUint32(18, true);
  // Streamed entries leave the local sizes at 0; read up to the next part then.
  const end = compressedSize && compressedSize !== MAX_U32 ? start + compressedSize : Bun.file(path).size;
  const data = new Uint8Array(await Bun.file(path).slice(start, end).arrayBuffer());
  if (entry.method === 0) return data.subarray(0, entry.size);
  if (entry.method === 8) return new Uint8Array(inflateRawSync(data)).subarray(0, entry.size);
  throw new Error(`unsupported zip compression method ${entry.method}`);
}

/** Parses `7z l -slt` output into entries. */
export function parseSevenZipListing(output: string): ArchiveEntry[] {
  const entries: ArchiveEntry[] = [];
  for (const block of output.split(/\r?\n\r?\n/)) {
    const fields = new Map<string, string>();
    for (let line of block.split(/\r?\n/)) {
      // Progress output ends in backspaces and can share a line with a field.
      line = line.slice(line.lastIndexOf("\b") + 1);
      const at = line.indexOf(" = ");
      if (at > 0) fields.set(line.slice(0, at).trim(), line.slice(at + 3));
    }
    const name = fields.get("Path");
    const size = fields.get("Size");
    if (!name || size === undefined || fields.get("Folder") === "+" || fields.get("Attributes")?.includes("D")) continue;
    const crc = fields.get("CRC");
    entries.push({ name, size: Number(size), crc32: crc ? Number.parseInt(crc, 16) : null });
  }
  return entries;
}
