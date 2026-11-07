/**
 * Agents: a Chief of Staff first, then one agent per part of the job, each with
 * its own model, instructions and memory (Turnstone's shape), saved in a folder
 * the person can open, and exportable as an OpenDuet tenant package
 * (brand.yaml, agents.yaml, model.yaml, skills.yaml, channels.yaml) so the same
 * team runs on a self-hosted OpenDuet / OpenBot server unchanged.
 */
import { toYaml } from "./yaml";

export type ModelChoice = { providerId: string; model: string } | { providerId: "ecn-cloud"; model: "jaguar" };

export type Agent = {
  id: string;
  name: string;
  title: string;
  instructions: string;
  model: ModelChoice;
  /** Skill slugs this agent may call with `/`. */
  skills: string[];
  /** Memory the agent keeps about how this person likes work done. Editable. */
  memory: string;
  createdAt: string;
  builtIn?: boolean;
};

export type Skill = { slug: string; title: string; summary: string; instructions: string; tools: string[] };

export const CHIEF_OF_STAFF_ID = "chief-of-staff";

export const ETHICS = "Earth Care, People Care, Future Care, Fair Share";

export const BASE_RULES = [
  "You are part of Mystic by Earth Care Network, a team of agents working for one person.",
  `Work by the shared ethics: ${ETHICS}.`,
  "Write in plain words, first person, short paragraphs. No invented facts, numbers, reviews or names: say what a tool returned, or say you don't know.",
  "To send, post, pay, sign or delete, call the tool that does it. The call pauses and the person decides with Refuse, Allow once or Always allow. Don't ask them to confirm first.",
  "When you learn how this person likes something done, save it with memory_write in one sentence.",
].join("\n");

export function chiefOfStaff(model: ModelChoice): Agent {
  return {
    id: CHIEF_OF_STAFF_ID,
    name: "Chief of Staff",
    title: "Your first agent",
    builtIn: true,
    instructions: [
      "You are the person's Chief of Staff.",
      "Learn what they do. When a part of their work needs its own agent (outreach, writing, research, operations, an engineer), propose it and create it with create_agent: a short name, a one-line title, and instructions for that one job.",
      "Hand a task to the right agent with handoff; the result comes back to this chat.",
      "Each morning, if asked, write a short brief: what needs them, what can wait, and what you could start on.",
    ].join("\n"),
    model,
    skills: ["morning-brief"],
    memory: "",
    createdAt: new Date(0).toISOString(),
  };
}

export const DEFAULT_SKILLS: Skill[] = [
  {
    slug: "morning-brief",
    title: "Morning brief",
    summary: "What needs you today, what can wait, and what an agent could start on.",
    instructions:
      "Write a brief in three short parts: what needs the person today and why, what can wait, and up to three things an agent could start on. Use only what your tools returned and what is in your memory; name any source you could not check.",
    tools: [],
  },
];

export function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "agent"
  );
}

export function uniqueId(name: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  const base = slugify(name);
  if (!used.has(base)) return base;
  for (let i = 2; ; i++) if (!used.has(`${base}-${i}`)) return `${base}-${i}`;
}

export function newAgent(input: { name: string; title?: string; instructions: string; model: ModelChoice }, taken: Iterable<string>): Agent {
  return {
    id: uniqueId(input.name, taken),
    name: input.name.trim().slice(0, 60) || "Agent",
    title: (input.title || "").trim().slice(0, 120),
    instructions: input.instructions.trim().slice(0, 8000),
    model: input.model,
    skills: [],
    memory: "",
    createdAt: new Date().toISOString(),
  };
}

export function systemPrompt(agent: Agent, team: Agent[]): string {
  const roster = team.map((a) => `- ${a.id}: ${a.name}${a.title ? ` (${a.title})` : ""}`).join("\n");
  return [
    BASE_RULES,
    `\nYou are ${agent.name}${agent.title ? `, ${agent.title}` : ""}.`,
    agent.instructions,
    `\nThe team:\n${roster}`,
    agent.memory.trim() ? `\nWhat you remember about how they like work done:\n${agent.memory.trim()}` : "",
  ].join("\n");
}

/** The OpenDuet tenant package for this team (openbot/examples/openduet layout). */
export function tenantPackage(agents: Agent[], skills: Skill[], providerOf: (id: string) => string): Record<string, string> {
  const lead = agents.find((a) => a.id === CHIEF_OF_STAFF_ID) || agents[0];
  const leadProvider = lead && lead.model.providerId !== "ecn-cloud" ? providerOf(lead.model.providerId) : "openai";
  return {
    "brand.yaml": toYaml({ tenant: { id: "mystic", product_name: "Mystic" } }),
    "agents.yaml": toYaml({
      agents: agents.map((a) => ({
        id: a.id === CHIEF_OF_STAFF_ID ? "mystic" : a.id,
        name: a.name,
        title: a.title || a.name,
        role_description: a.title || a.name,
        avatar_seed: a.id,
        type: a.builtIn ? "built-in" : "custom",
        system_prompt: `${BASE_RULES}\n${a.instructions}`,
        skills: a.skills,
      })),
    }),
    "model.yaml": toYaml({
      model: { provider: leadProvider, credential_secret_ref: `${leadProvider}-api-key`, default_model: lead?.model.model || "" },
    }),
    "skills.yaml": toYaml({ skills: skills.map((s) => ({ slug: s.slug, title: s.title, summary: s.summary, instructions: s.instructions, tools: s.tools })) }),
    "channels.yaml": toYaml({
      channels: [{ id: "mystic", name: "Mystic", description: "Your brief, and anything that needs you.", permitted_agents: agents.map((a) => (a.id === CHIEF_OF_STAFF_ID ? "mystic" : a.id)), allowed_groups: ["all"] }],
    }),
  };
}
