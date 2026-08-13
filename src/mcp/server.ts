import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { evaluate, evaluateTask } from "../core/evaluator.js";
import { loadPolicy } from "../core/policy.js";

function response(value: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
  };
}

export async function runMcpServer(
  root: string,
  policyPath?: string,
): Promise<void> {
  const policy = await loadPolicy(root, policyPath);
  const server = new McpServer({ name: "guardspec", version: "0.1.0" });
  server.registerTool(
    "get_repository_policy",
    {
      description:
        "Return the resolved, read-only GuardSpec repository policy with provenance.",
      inputSchema: {},
    },
    async () => response(policy),
  );
  server.registerTool(
    "can_modify_path",
    {
      description:
        "Deterministically check whether a repository-relative path may be modified.",
      inputSchema: { path: z.string().min(1) },
    },
    async ({ path }) => response(evaluate(policy, "path", path)),
  );
  server.registerTool(
    "can_run_command",
    {
      description:
        "Deterministically check a proposed command against declared policy. This never executes a command.",
      inputSchema: { command: z.string().min(1) },
    },
    async ({ command }) => response(evaluate(policy, "command", command)),
  );
  server.registerTool(
    "required_checks",
    {
      description:
        "Return all required repository checks and their source provenance.",
      inputSchema: {},
    },
    async () =>
      response(
        policy.rules.filter(
          (rule) => rule.kind === "check" && rule.effect === "require",
        ),
      ),
  );
  server.registerTool(
    "explain_rule",
    {
      description: "Explain a policy rule by id, including source provenance.",
      inputSchema: { ruleId: z.string().min(1) },
    },
    async ({ ruleId }) =>
      response(
        policy.rules.find((rule) => rule.id === ruleId) ?? {
          error: "Rule not found",
        },
      ),
  );
  server.registerTool(
    "preflight_task",
    {
      description:
        "Evaluate proposed paths, commands, network domains, MCP servers and AI disclosure before any work begins. This is read-only.",
      inputSchema: {
        paths: z.array(z.string()).optional(),
        commands: z.array(z.string()).optional(),
        networkDomains: z.array(z.string()).optional(),
        mcpServers: z.array(z.string()).optional(),
        aiAssisted: z.boolean().optional(),
      },
    },
    async (request) =>
      response(
        evaluateTask(policy, {
          ...(request.paths ? { paths: request.paths } : {}),
          ...(request.commands ? { commands: request.commands } : {}),
          ...(request.networkDomains
            ? { networkDomains: request.networkDomains }
            : {}),
          ...(request.mcpServers ? { mcpServers: request.mcpServers } : {}),
          ...(request.aiAssisted === undefined
            ? {}
            : { aiAssisted: request.aiAssisted }),
        }),
      ),
  );
  await server.connect(new StdioServerTransport());
}
