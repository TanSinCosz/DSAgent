import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Runtime } from "../types/runtime.js";
import type { PlanState, State } from "../types/state.js";

const PLANS_DIRECTORY = ".opencat/plans";

/** Returns the durable plan path for the current session/agent. */
export function getPlanFilePath(runtime: Runtime): string {
  const sessionId = sanitizePathPart(runtime.sessionId);
  const agentId = sanitizePathPart(runtime.agentId);
  return join(runtime.cwd, PLANS_DIRECTORY, `${sessionId}-${agentId}.md`);
}

export async function persistPlan(
  runtime: Runtime,
  state: State,
  content: string,
): Promise<PlanState> {
  const plan: PlanState = {
    path: getPlanFilePath(runtime),
    content,
    updatedAt: Date.now(),
  };

  await mkdir(dirname(plan.path), { recursive: true });
  await writeFile(plan.path, content, "utf8");
  state.plan = plan;
  return plan;
}

/** Rehydrates a plan from state first, then from its durable file. */
export async function restorePlan(
  runtime: Runtime,
  state: State,
): Promise<PlanState | undefined> {
  if (state.plan) {
    return state.plan;
  }

  const path = getPlanFilePath(runtime);
  try {
    const content = (await readFile(path, "utf8")).trim();
    if (!content) {
      return undefined;
    }

    state.plan = {
      path,
      content,
      updatedAt: Date.now(),
    };
    return state.plan;
  } catch (error) {
    if (isFileMissing(error)) {
      return undefined;
    }
    throw error;
  }
}

function sanitizePathPart(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "-");
}

function isFileMissing(error: unknown): boolean {
  return typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT";
}
