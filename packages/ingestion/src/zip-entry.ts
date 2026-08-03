// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

/**
 * Reading one entry out of a ZIP archive, without a dependency.
 *
 * One source serves its payload as a base64 ZIP containing a single text file.
 * Node ships inflate but not an archive reader, and the alternatives are a
 * dependency that reads far more of the format than this needs or a ten-line
 * slice of the local file header. The ten-line version is the tempting one and it
 * is wrong in a way that only shows up later: when the writer sets the
 * data-descriptor flag, the sizes in the local header are zero and the real ones
 * are in a trailer, so a reader that trusts the local header silently produces an
 * empty entry.
 *
 * So this reads the central directory, which is authoritative, and checks the
 * CRC the archive itself records. These are untrusted bytes from a third party
 * and every offset in them is attacker-influenced, which is why each one is range
 * checked before it is used rather than handed to `subarray`, whose answer to an
 * out-of-range slice is a short buffer and no complaint.
 */
import { crc32, inflateRawSync } from 'node:zlib';

/** Signatures, little-endian, as the format defines them. */
const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const CENTRAL_FILE_HEADER = 0x02014b50;
const LOCAL_FILE_HEADER = 0x04034b50;

/** Fixed sizes of the three records this reader touches. */
const END_OF_CENTRAL_DIRECTORY_SIZE = 22;
const CENTRAL_FILE_HEADER_SIZE = 46;
const LOCAL_FILE_HEADER_SIZE = 30;

/**
 * How far back to look for the end-of-central-directory record.
 *
 * It sits at the very end unless the archive carries a comment, which may be up
 * to 64 KiB. Scanning that much and no more means a truncated archive is
 * reported as unreadable instead of turning into a scan of the whole file for a
 * four-byte pattern that will match some compressed data eventually.
 */
const MAXIMUM_COMMENT_LENGTH = 0xffff;

/** The two compression methods a real archive uses for text. */
const METHOD_STORED = 0;
const METHOD_DEFLATED = 8;

export class ZipReadError extends Error {
  public constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ZipReadError';
  }
}

export interface ZipEntry {
  readonly name: string;
  readonly bytes: Buffer;
}

/**
 * Extracts the single entry from a one-entry archive.
 *
 * Single-entry on purpose. The payloads this reads hold one file, and an archive
 * that suddenly holds two is a change upstream that somebody should look at
 * rather than a case to guess at by picking the first.
 *
 * @param maximumBytes Cap on the uncompressed size, checked against what the
 *   archive claims *before* inflating and against what inflating produced after.
 *   A compression bomb declares a small size and expands to a large one, so the
 *   claim alone is not a limit.
 * @throws {ZipReadError} for anything malformed, oversized, or not one entry.
 */
export function readSingleZipEntry(archive: Buffer, maximumBytes: number): ZipEntry {
  const end = findEndOfCentralDirectory(archive);

  const entryCount = archive.readUInt16LE(end + 10);
  if (entryCount !== 1) {
    throw new ZipReadError(`Expected an archive of one entry, found ${String(entryCount)}.`);
  }

  const directoryOffset = archive.readUInt32LE(end + 16);
  if (directoryOffset + CENTRAL_FILE_HEADER_SIZE > end) {
    throw new ZipReadError('Central directory offset falls outside the archive.');
  }
  if (archive.readUInt32LE(directoryOffset) !== CENTRAL_FILE_HEADER) {
    throw new ZipReadError('Central directory offset does not point at a file header.');
  }

  const method = archive.readUInt16LE(directoryOffset + 10);
  const expectedCrc = archive.readUInt32LE(directoryOffset + 16);
  const compressedSize = archive.readUInt32LE(directoryOffset + 20);
  const uncompressedSize = archive.readUInt32LE(directoryOffset + 24);
  const nameLength = archive.readUInt16LE(directoryOffset + 28);
  const localOffset = archive.readUInt32LE(directoryOffset + 42);

  if (uncompressedSize > maximumBytes) {
    throw new ZipReadError(
      `Entry declares ${String(uncompressedSize)} bytes, above the ${String(maximumBytes)} byte limit.`,
    );
  }

  const name = readString(archive, directoryOffset + CENTRAL_FILE_HEADER_SIZE, nameLength);

  // The name is read from the central directory and never used as a path. It is
  // reported so a caller can say which entry it got; joining it to a directory
  // is how an archive gets to write outside the one it was extracted into.
  if (name.includes('\0')) {
    throw new ZipReadError('Entry name contains a null byte.');
  }

  const bytes = inflateEntry({
    archive,
    localOffset,
    method,
    compressedSize,
    uncompressedSize,
    maximumBytes,
  });

  const actualCrc = crc32(bytes);
  if (actualCrc !== expectedCrc) {
    // Identifiers only. The bytes are somebody's data and do not belong in a log.
    throw new ZipReadError(
      `Entry failed its checksum: archive records ${expectedCrc.toString(16)}, ` +
        `the bytes give ${actualCrc.toString(16)}.`,
    );
  }

  return { name, bytes };
}

interface InflateRequest {
  readonly archive: Buffer;
  readonly localOffset: number;
  readonly method: number;
  readonly compressedSize: number;
  readonly uncompressedSize: number;
  readonly maximumBytes: number;
}

function inflateEntry(request: InflateRequest): Buffer {
  const { archive, localOffset, method, compressedSize, uncompressedSize, maximumBytes } = request;

  if (localOffset + LOCAL_FILE_HEADER_SIZE > archive.length) {
    throw new ZipReadError('Local header offset falls outside the archive.');
  }
  if (archive.readUInt32LE(localOffset) !== LOCAL_FILE_HEADER) {
    throw new ZipReadError('Local header offset does not point at a local file header.');
  }

  // Read from the *local* header, not the central one: the two name and extra
  // field lengths are allowed to differ, and it is this copy that says where the
  // compressed bytes start.
  const nameLength = archive.readUInt16LE(localOffset + 26);
  const extraLength = archive.readUInt16LE(localOffset + 28);
  const start = localOffset + LOCAL_FILE_HEADER_SIZE + nameLength + extraLength;
  const finish = start + compressedSize;
  if (finish > archive.length) {
    throw new ZipReadError('Entry data runs past the end of the archive.');
  }

  const compressed = archive.subarray(start, finish);

  if (method === METHOD_STORED) {
    if (compressedSize !== uncompressedSize) {
      throw new ZipReadError('A stored entry declares two different sizes.');
    }
    return Buffer.from(compressed);
  }
  if (method !== METHOD_DEFLATED) {
    throw new ZipReadError(`Unsupported compression method ${String(method)}.`);
  }

  let inflated: Buffer;
  try {
    // `maxOutputLength` is the limit that actually holds: the declared size is a
    // claim by the archive, and this is a measurement by the decompressor.
    inflated = inflateRawSync(compressed, { maxOutputLength: maximumBytes });
  } catch (cause) {
    throw new ZipReadError('Entry data could not be decompressed.', { cause });
  }

  if (inflated.length !== uncompressedSize) {
    throw new ZipReadError(
      `Entry inflated to ${String(inflated.length)} bytes, not the declared ${String(uncompressedSize)}.`,
    );
  }
  return inflated;
}

/**
 * Finds the end-of-central-directory record by scanning backwards.
 *
 * Backwards because the record is at the end and its signature can also occur
 * inside compressed data; the last match is the one the format means. The scan
 * is bounded by the largest comment the format permits.
 */
function findEndOfCentralDirectory(archive: Buffer): number {
  if (archive.length < END_OF_CENTRAL_DIRECTORY_SIZE) {
    throw new ZipReadError('Too short to be an archive.');
  }

  const earliest = Math.max(
    0,
    archive.length - END_OF_CENTRAL_DIRECTORY_SIZE - MAXIMUM_COMMENT_LENGTH,
  );
  for (let offset = archive.length - END_OF_CENTRAL_DIRECTORY_SIZE; offset >= earliest; offset--) {
    if (archive.readUInt32LE(offset) === END_OF_CENTRAL_DIRECTORY) {
      return offset;
    }
  }
  throw new ZipReadError('No end-of-central-directory record found.');
}

/** Reads a length-prefixed field, refusing one that runs off the end. */
function readString(archive: Buffer, start: number, length: number): string {
  if (start + length > archive.length) {
    throw new ZipReadError('A header field runs past the end of the archive.');
  }
  return archive.toString('utf8', start, start + length);
}
