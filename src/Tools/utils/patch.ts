import { structuredPatch } from "diff";

export type StructuredPatchHunk = {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: string[];
};

export function createStructuredPatch(
  filePath: string,
  originalContent: string,
  updatedContent: string,
): StructuredPatchHunk[] {
  return structuredPatch(
    filePath,
    filePath,
    originalContent,
    updatedContent,
    undefined,
    undefined,
    { context: 3 },
  ).hunks.map((hunk) => ({
    oldStart: hunk.oldStart,
    oldLines: hunk.oldLines,
    newStart: hunk.newStart,
    newLines: hunk.newLines,
    lines: hunk.lines,
  }));
}
