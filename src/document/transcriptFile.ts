import type { EditWord } from "./words";

/**
 * The transcript as a file (#395): the words of an edit, as it is cut now, in short lines. An SRT file
 * (subtitles any editor or site reads) gives each line its start and end; a TXT file is the words alone.
 */

/** A pause this long, or the end of a sentence, starts a new line. */
const BREAK = 0.7;
/** The most words a line holds. */
const MOST = 14;
/** The least time a subtitle stays up, so a one-word line is never a flash. */
const LEAST = 0.4;

export interface TranscriptLine {
  /** Seconds of the frame. */
  s: number;
  e: number;
  words: EditWord[];
}

/** Words grouped into short lines: a long pause, a full stop or fourteen words ends one. */
export function transcriptLines(words: EditWord[]): EditWord[][] {
  const out: EditWord[][] = [];
  let run: EditWord[] = [];
  for (const w of words) {
    const last = run[run.length - 1];
    if (last && (w.s - last.e > BREAK || /[.?!]$/.test(last.w) || run.length >= MOST)) {
      out.push(run);
      run = [];
    }
    run.push(w);
  }
  if (run.length) out.push(run);
  return out;
}

const pad = (n: number, width: number) => String(n).padStart(width, "0");

/** Seconds as an SRT time: 00:01:02,500. */
export function srtTime(seconds: number): string {
  const ms = Math.round(Math.max(0, seconds) * 1000);
  return `${pad(Math.floor(ms / 3_600_000), 2)}:${pad(Math.floor(ms / 60_000) % 60, 2)}:${pad(Math.floor(ms / 1000) % 60, 2)},${pad(ms % 1000, 3)}`;
}

/** The transcript as an SRT file: numbered lines, each with when it appears and when it goes. */
export function toSrt(words: EditWord[]): string {
  const rows = transcriptLines(words);
  return rows
    .map((row, i) => {
      const start = row[0].s;
      const next = rows[i + 1]?.[0].s;
      let end = Math.max(row[row.length - 1].e, start + LEAST);
      // a line never stays up into the next one
      if (next !== undefined && end > next) end = Math.max(next, start + 0.05);
      return `${i + 1}\n${srtTime(start)} --> ${srtTime(end)}\n${row.map((w) => w.w).join(" ")}\n`;
    })
    .join("\n");
}

/** The transcript as plain text: one short line after another. */
export function toTxt(words: EditWord[]): string {
  const rows = transcriptLines(words);
  return rows.length ? `${rows.map((row) => row.map((w) => w.w).join(" ")).join("\n")}\n` : "";
}
