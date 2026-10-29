/**
 * The one place the Anthropic Messages API is called with tools. Provider SDK calls
 * stay outside Claire's production surfaces (server/claire/domainPortArchitecture.test.ts);
 * Claire code passes a client and parameters through here.
 */
import Anthropic from "@anthropic-ai/sdk";
import { ENV } from "./env";

export type AnthropicMessagesClient = Pick<Anthropic, "messages">;

export function anthropicMessagesClient(): Anthropic {
  return new Anthropic({ apiKey: ENV.anthropicApiKey });
}

export function createAnthropicMessage(
  client: AnthropicMessagesClient,
  params: Anthropic.MessageCreateParamsNonStreaming
): Promise<Anthropic.Message> {
  return client.messages.create(params);
}
