import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { parse, stringify } from "yaml";
import { z } from "zod";
import { safeResolve } from "./fs-safe.js";
import type { Policy, PolicyRule, Provenance } from "./types.js";

const provenanceSchema = z.object({
  source: z.string().min(1),
  line: z.number().int().positive(),
  adapter: z.enum([
    "agents-md",
    "claude",
    "copilot",
    "cursor",
    "gemini",
    "opencode",
    "mcp",
    "codeowners",
    "repository-doc",
    "manifest",
    "policy",
  ]),
  excerpt: z.string(),
  confidence: z.enum(["high", "medium", "manual"]),
});

const ruleSchema = z.object({
  id: z
    .string()
    .min(1)
    .regex(/^[a-z0-9-]+$/),
  kind: z.enum([
    "path",
    "command",
    "network",
    "mcp",
    "check",
    "approval",
    "disclosure",
  ]),
  effect: z.enum(["allow", "deny", "require", "warn"]),
  scope: z.string().min(1),
  value: z.union([z.string(), z.array(z.string()), z.boolean()]).optional(),
  severity: z.enum(["info", "low", "medium", "high", "critical"]),
  message: z.string().min(1),
  provenance: z.array(provenanceSchema).min(1),
});

const policySchema = z
  .object({
    version: z.literal(1),
    name: z.string().min(1).max(120),
    generatedAt: z.string().datetime().optional(),
    rules: z.array(ruleSchema).max(2_000),
    overrides: z
      .array(
        z
          .object({
            ruleIds: z.array(z.string()).min(1),
            resolution: z.string().min(1),
            rationale: z.string().min(1),
          })
          .strict(),
      )
      .optional(),
  })
  .strict();

export function parsePolicy(input: string): Policy {
  let raw: unknown;
  try {
    raw = parse(input, { maxAliasCount: 20 });
  } catch (error) {
    throw new Error(
      `Invalid YAML policy: ${error instanceof Error ? error.message : "unknown error"}`,
    );
  }
  const parsed = policySchema.safeParse(raw);
  if (!parsed.success)
    throw new Error(
      `Invalid policy schema: ${parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")}`,
    );
  const seen = new Set<string>();
  for (const current of parsed.data.rules) {
    if (seen.has(current.id))
      throw new Error(`Duplicate policy rule id: ${current.id}`);
    seen.add(current.id);
  }
  return parsed.data as Policy;
}

export async function loadPolicy(
  root: string,
  policyPath = ".agent-policy.yml",
): Promise<Policy> {
  const contents = await readFile(safeResolve(root, policyPath), "utf8");
  return parsePolicy(contents);
}

export function policyTemplate(name: string, rules: PolicyRule[]): Policy {
  const sorted = [...rules].sort((left, right) =>
    left.id.localeCompare(right.id),
  );
  return {
    version: 1,
    name,
    generatedAt: new Date().toISOString(),
    rules: sorted,
  };
}

export function stringifyPolicy(policy: Policy): string {
  return `# GuardSpec policy. Review every generated rule before relying on it.\n# Sources are preserved as provenance; GuardSpec never claims unparsed prose is enforced.\n${stringify(policy, { lineWidth: 0 })}`;
}

export async function writePolicy(
  root: string,
  policy: Policy,
  policyPath = ".agent-policy.yml",
): Promise<void> {
  await writeFile(
    safeResolve(root, policyPath),
    stringifyPolicy(policy),
    "utf8",
  );
}

export function manualProvenance(): Provenance {
  return {
    source: ".agent-policy.yml",
    line: 1,
    adapter: "policy",
    excerpt: "Manually authored policy rule.",
    confidence: "manual",
  };
}

export function policyDigest(policy: Policy): string {
  const canonical = {
    version: policy.version,
    name: policy.name,
    rules: [...policy.rules]
      .map((rule) => ({
        id: rule.id,
        kind: rule.kind,
        effect: rule.effect,
        scope: rule.scope,
        value: rule.value ?? null,
        severity: rule.severity,
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
  };
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

export const policyJsonSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "GuardSpec policy",
  type: "object",
  required: ["version", "name", "rules"],
  properties: {
    version: { const: 1 },
    name: { type: "string" },
    generatedAt: { type: "string", format: "date-time" },
    rules: { type: "array" },
  },
} as const;
