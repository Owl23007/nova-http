export interface RangeResult {
  start: number;
  end: number;
}

export function parseRange(rangeHeader: string, fileSize: number): RangeResult | null {
  const match = rangeHeader.match(/^bytes=(\d*)-(\d*)$/);
  if (!match) return null;
  const startText = match[1];
  const endText = match[2];
  let start: number;
  let end: number;
  if (startText === "") {
    const suffixLength = Number.parseInt(endText, 10);
    if (Number.isNaN(suffixLength)) return null;
    start = Math.max(0, fileSize - suffixLength);
    end = fileSize - 1;
  } else {
    start = Number.parseInt(startText, 10);
    end = endText === "" ? fileSize - 1 : Number.parseInt(endText, 10);
  }
  if (Number.isNaN(start) || Number.isNaN(end) || start > end || end >= fileSize || start < 0)
    return null;
  return { start, end };
}
