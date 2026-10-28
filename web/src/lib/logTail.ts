import { promises as fs } from "fs";

const DEFAULT_TAIL_BYTES = 64 * 1024;
const MAX_TAIL_LINES = 2_000;

/**
 * Read only the end of a log file.
 *
 * Job status screens poll logs while a process is running. Reading and splitting
 * the complete log on every poll makes I/O and memory use grow with job age.
 */
export async function readLogTail(
  filePath: string,
  maxLines = 100,
  maxBytes = DEFAULT_TAIL_BYTES,
): Promise<string> {
  const lineLimit = Number.isFinite(maxLines)
    ? Math.min(MAX_TAIL_LINES, Math.max(1, Math.trunc(maxLines)))
    : 100;
  const byteLimit = Number.isFinite(maxBytes)
    ? Math.max(1_024, Math.min(DEFAULT_TAIL_BYTES, Math.trunc(maxBytes)))
    : DEFAULT_TAIL_BYTES;

  const file = await fs.open(filePath, "r");
  try {
    const { size } = await file.stat();
    if (size === 0) return "";

    const bytesToRead = Math.min(size, byteLimit);
    const buffer = Buffer.allocUnsafe(bytesToRead);
    const { bytesRead } = await file.read(buffer, 0, bytesToRead, size - bytesToRead);
    let text = buffer.subarray(0, bytesRead).toString("utf8");
    const truncated = size > bytesRead;

    // A partial first line is caused by starting the read in the middle of the file.
    if (truncated) {
      const firstNewline = text.indexOf("\n");
      if (firstNewline >= 0) text = text.slice(firstNewline + 1);
    }

    const lines = text.split(/\r?\n/);
    if (lines.at(-1) === "") lines.pop();
    const tail = lines.slice(-lineLimit).join("\n");

    return truncated ? `[... earlier log output omitted ...]\n${tail}` : tail;
  } finally {
    await file.close();
  }
}
