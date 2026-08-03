// Copyright 2026 Jason Smathers
// SPDX-License-Identifier: Apache-2.0

import { crc32, deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';

import { ZipReadError, readSingleZipEntry } from './zip-entry.js';

const LIMIT = 1024 * 1024;

interface ArchiveOptions {
  readonly name?: string;
  readonly deflate?: boolean;
  /** Written into both headers in place of the real checksum. */
  readonly crcOverride?: number;
  /** Written into both headers in place of the real uncompressed length. */
  readonly declaredSize?: number;
  /** Zeroes the sizes in the *local* header only, as a data descriptor does. */
  readonly dataDescriptor?: boolean;
  readonly comment?: string;
  readonly entryCount?: number;
}

/**
 * Builds a single-entry archive.
 *
 * Written out here rather than shelling to `zip` so that a case can produce an
 * archive no writer would: a wrong checksum, a lying size, sizes that live only
 * in a trailer. Those are the cases worth having, and they cannot be fixtures.
 */
function archive(contents: string, options: ArchiveOptions = {}): Buffer {
  const name = Buffer.from(options.name ?? 'compressed.txt', 'utf8');
  const raw = Buffer.from(contents, 'utf8');
  const deflate = options.deflate ?? true;
  const body = deflate ? deflateRawSync(raw) : raw;
  const checksum = options.crcOverride ?? crc32(raw);
  const size = options.declaredSize ?? raw.length;
  const method = deflate ? 8 : 0;

  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(options.dataDescriptor === true ? 0x0008 : 0, 6);
  local.writeUInt16LE(method, 8);
  local.writeUInt32LE(options.dataDescriptor === true ? 0 : checksum, 14);
  local.writeUInt32LE(options.dataDescriptor === true ? 0 : body.length, 18);
  local.writeUInt32LE(options.dataDescriptor === true ? 0 : size, 22);
  local.writeUInt16LE(name.length, 26);

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(options.dataDescriptor === true ? 0x0008 : 0, 8);
  central.writeUInt16LE(method, 10);
  central.writeUInt32LE(checksum, 16);
  central.writeUInt32LE(body.length, 20);
  central.writeUInt32LE(size, 24);
  central.writeUInt16LE(name.length, 28);
  central.writeUInt32LE(0, 42);

  const directoryOffset = local.length + name.length + body.length;
  const directory = Buffer.concat([central, name]);
  const comment = Buffer.from(options.comment ?? '', 'utf8');

  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(options.entryCount ?? 1, 8);
  end.writeUInt16LE(options.entryCount ?? 1, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(directoryOffset, 16);
  end.writeUInt16LE(comment.length, 20);

  return Buffer.concat([local, name, body, directory, end, comment]);
}

describe('readSingleZipEntry', () => {
  it('returns the entry a writer put in', () => {
    const entry = readSingleZipEntry(archive('{"records":[]}'), LIMIT);
    expect(entry.name).toBe('compressed.txt');
    expect(entry.bytes.toString('utf8')).toBe('{"records":[]}');
  });

  it('reads a stored entry as well as a deflated one', () => {
    const entry = readSingleZipEntry(archive('plain', { deflate: false }), LIMIT);
    expect(entry.bytes.toString('utf8')).toBe('plain');
  });

  it('reads an entry whose sizes are only in the central directory', () => {
    // The case the obvious implementation gets wrong. With the data-descriptor
    // flag set, the local header's sizes are zero and a reader that trusts them
    // returns an empty entry -- successfully, which is the problem.
    const entry = readSingleZipEntry(archive('not empty', { dataDescriptor: true }), LIMIT);
    expect(entry.bytes.toString('utf8')).toBe('not empty');
  });

  it('finds the directory behind an archive comment', () => {
    const entry = readSingleZipEntry(archive('commented', { comment: 'x'.repeat(300) }), LIMIT);
    expect(entry.bytes.toString('utf8')).toBe('commented');
  });

  it('rejects an entry whose checksum does not match', () => {
    expect(() => readSingleZipEntry(archive('payload', { crcOverride: 1 }), LIMIT)).toThrow(
      ZipReadError,
    );
  });

  it('does not put the entry contents in a checksum failure', () => {
    // The payloads this reads carry people's names. A failure message that
    // quoted the bytes would put them in a CI transcript.
    let thrown: unknown;
    try {
      readSingleZipEntry(archive('Fixture Lifter', { crcOverride: 1 }), LIMIT);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ZipReadError);
    expect((thrown as Error).message).not.toContain('Fixture Lifter');
  });

  it('rejects an entry that inflates to a different length than it declared', () => {
    expect(() => readSingleZipEntry(archive('payload', { declaredSize: 4 }), LIMIT)).toThrow(
      /inflated to/,
    );
  });

  it('refuses an entry that declares more than the caller allows', () => {
    expect(() => readSingleZipEntry(archive('a'.repeat(200)), 100)).toThrow(/above the 100 byte/);
  });

  it('refuses an entry that expands past the limit whatever it declared', () => {
    // A declared size is a claim by the archive. This one claims to be small and
    // is not, which is the shape of every decompression bomb.
    expect(() => readSingleZipEntry(archive('a'.repeat(200), { declaredSize: 10 }), 100)).toThrow(
      ZipReadError,
    );
  });

  it('refuses an archive holding more than one entry', () => {
    expect(() => readSingleZipEntry(archive('payload', { entryCount: 2 }), LIMIT)).toThrow(
      /one entry/,
    );
  });

  it.each([
    ['empty', Buffer.alloc(0)],
    ['too short', Buffer.alloc(10)],
    ['not an archive', Buffer.from('a'.repeat(400), 'utf8')],
  ])('refuses %s input', (_case, bytes) => {
    expect(() => readSingleZipEntry(bytes, LIMIT)).toThrow(ZipReadError);
  });

  it('refuses a directory offset pointing outside the archive', () => {
    const bytes = archive('payload');
    // The end record is the last 22 bytes with no comment.
    bytes.writeUInt32LE(0xffff, bytes.length - 22 + 16);
    expect(() => readSingleZipEntry(bytes, LIMIT)).toThrow(/outside the archive/);
  });

  it('refuses a local header offset pointing at something else', () => {
    const bytes = archive('payload');
    const directoryOffset = bytes.readUInt32LE(bytes.length - 22 + 16);
    bytes.writeUInt32LE(1, directoryOffset + 42);
    expect(() => readSingleZipEntry(bytes, LIMIT)).toThrow(/local file header/);
  });

  it('refuses an unsupported compression method', () => {
    const bytes = archive('payload');
    const directoryOffset = bytes.readUInt32LE(bytes.length - 22 + 16);
    bytes.writeUInt16LE(9, directoryOffset + 10);
    expect(() => readSingleZipEntry(bytes, LIMIT)).toThrow(/method 9/);
  });
});
