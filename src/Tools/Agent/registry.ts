import { getBuiltInAgents } from "./built-in.js";
import type { AgentDefinition, AgentDefinitionsResult } from "./definitions.js";

export function getActiveAgentsFromList(
  allAgents: readonly AgentDefinition[],
): AgentDefinition[] {
  const groups = [
    allAgents.filter((agent) => agent.source === "built-in"),
    allAgents.filter((agent) => agent.source === "plugin"),
    allAgents.filter((agent) => agent.source === "userSettings"),
    allAgents.filter((agent) => agent.source === "projectSettings"),
    allAgents.filter((agent) => agent.source === "flagSettings"),
    allAgents.filter((agent) => agent.source === "policySettings"),
    allAgents.filter((agent) => agent.source === "localSettings"),
  ];

  const byType = new Map<string, AgentDefinition>();
  for (const group of groups) {
    for (const agent of group) {
      byType.set(agent.agentType, agent);
    }
  }

  return Array.from(byType.values());
}

export function createAgentDefinitions(
  customAgents: readonly AgentDefinition[] = [],
): AgentDefinitionsResult {
  const allAgents = [...getBuiltInAgents(), ...customAgents];
  return {
    allAgents,
    activeAgents: getActiveAgentsFromList(allAgents),
  };
}

export function findAgentDefinition(
  agents: readonly AgentDefinition[],
  agentType: string | undefined,
): AgentDefinition | undefined {
  if (!agentType) {
    return agents.find((agent) => agent.agentType === "general-purpose");
  }

  return agents.find((agent) => agent.agentType === agentType);
}
