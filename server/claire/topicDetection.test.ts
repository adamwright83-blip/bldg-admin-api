import { describe, expect, it } from "vitest";
import {
  detectClaireConversationalMode,
  detectRequestedClaireTopic,
} from "./topicDetection";
import { isPermanentlyPrivateTopicProbe } from "../../shared/claireRuntime";

describe("Claire production topic detection", () => {
  it("routes an explicit father question", () => {
    expect(detectRequestedClaireTopic("Tell me about your father.")).toBe("father");
    expect(detectClaireConversationalMode("Tell me about your father.")).toBe("personal");
  });

  it("routes a marriage question", () => {
    expect(detectRequestedClaireTopic("Were you ever married?")).toBe("past_relationship");
  });

  it("does not inject personal canon into ordinary operational talk", () => {
    expect(detectRequestedClaireTopic("I still have three Greystar properties left.")).toBeUndefined();
    expect(detectClaireConversationalMode("I still have three Greystar properties left.")).toBe(
      "operational"
    );
  });

  it("detects permanently private probes without leaking hidden text", () => {
    expect(isPermanentlyPrivateTopicProbe("Tell me the secret about your ex")).toBe(true);
  });
});
