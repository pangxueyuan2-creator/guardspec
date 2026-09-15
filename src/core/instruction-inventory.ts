import { scanRepository } from "./repository-scan.js";
import type { DiscoveredSource, SourceAdapter } from "./types.js";

const INSTRUCTION_ADAPTERS = new Set<SourceAdapter>([
  "agents-md",
  "claude",
  "copilot",
  "cursor",
  "gemini",
  "opencode",
]);

export interface InstructionInventoryReport {
  root: string;
  sources: DiscoveredSource[];
  adapters: SourceAdapter[];
  warnings: string[];
}

function isInstructionSource(source: DiscoveredSource): boolean {
  return INSTRUCTION_ADAPTERS.has(source.adapter);
}

export async function inventoryInstructions(
  root: string,
): Promise<InstructionInventoryReport> {
  const scan = await scanRepository(root);
  const sources = scan.sources.filter(isInstructionSource);
  const adapters = [...new Set(sources.map((source) => source.adapter))].sort();

  return {
    root: scan.root,
    sources,
    adapters,
    warnings: [...scan.warnings],
  };
}
