/**
 * A second model plays the operator for goal-driven scenarios, so a different
 * Claire gets a different conversation instead of a fixed script written
 * around the old Claire's failures (Anthropic, "Demystifying evals for AI
 * agents": conversational evals often require a second LLM to simulate the
 * user). It knows the operator's goals and voice, nothing about how Claire
 * works. It ends the call by saying a goodbye line and emitting [END].
 */
import Anthropic from "@anthropic-ai/sdk";
import { anthropicMessagesClient, createAnthropicMessage } from "../../../_core/anthropicMessages";
import { modelRequestShape } from "../../../_core/modelCapabilities";
import type { SimulatedOperator } from "./scenario";

export const SIMULATED_OPERATOR_MODEL = process.env.ANTHROPIC_MODEL_SIMULATED_OPERATOR?.trim() || "claude-sonnet-5-5";

export type OperatorSimulator = {
  opening: string;
  /** Given Claire's latest line, the operator's next line, and whether the operator is hanging up. */
  next: (claireSaid: string) => Promise<{ text: string; end: boolean }>;
};

export function openOperatorSimulator(spec: SimulatedOperator, input: { client?: Anthropic; model?: string } = {}): OperatorSimulator {
  const client = input.client ?? anthropicMessagesClient();
  const model = input.model ?? SIMULATED_OPERATOR_MODEL;
  const shape = modelRequestShape(model, {});
  const system = [
    `You are role-playing a small-business owner on a phone call with Claire, their assistant. Stay in character for the whole call. Speak the way this person speaks: spoken sentences, not written prose, no bullet points, no software words.`,
    `Who you are: ${spec.persona}`,
    `What you want from this call, in order of importance:\n${spec.goals.map((goal, index) => `${index + 1}. ${goal}`).join("\n")}`,
    `Rules of the role-play: say one thing at a time, the way people do on the phone. Answer Claire's questions when she asks something reasonable; if she asks you to confirm something you already told her to do, react the way this person would. Do not explain your goals to Claire as a list; bring them up naturally. When your goals are met, or you have run out of patience, say goodbye in character and end your message with the token [END]. Never describe actions or thoughts; output only the words you say.`,
  ].join("\n\n");
  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: `(Claire picks up.) Claire: "Claire here. What's up?"` },
    { role: "assistant", content: spec.opening },
  ];
  let turns = 1;
  return {
    opening: spec.opening,
    async next(claireSaid) {
      turns += 1;
      messages.push({ role: "user", content: `Claire: "${claireSaid}"${turns >= spec.maxTurns ? "\n\n(You are out of time: say goodbye now and end with [END].)" : ""}` });
      const response = await createAnthropicMessage(client, { model, max_tokens: 200, ...(shape as Record<string, unknown>), system, messages });
      const text = response.content.filter((block): block is Anthropic.TextBlock => block.type === "text").map(block => block.text).join(" ").trim();
      messages.push({ role: "assistant", content: text });
      const end = /\[END\]/.test(text) || turns >= spec.maxTurns;
      return { text: text.replace(/\s*\[END\]\s*/g, " ").trim(), end };
    },
  };
}
