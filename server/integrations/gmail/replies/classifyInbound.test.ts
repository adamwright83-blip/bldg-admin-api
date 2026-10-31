import { describe, expect, it } from "vitest";
import { addressOf, classifyInbound, referencedMessageIds } from "./classifyInbound";

const mailboxEmail = "nina@flowers.example";
const kind = (headers: Record<string, string>, labelIds: string[] = ["INBOX"]) => classifyInbound({ headers, labelIds, mailboxEmail });

describe("a human reply is told apart from everything that only looks like one", () => {
  it("a person writing back", () => {
    expect(kind({ From: "Elena Ruiz <elena@larkspurhotel.example>", Subject: "Re: Friday flowers?" })).toBe("human_reply");
  });
  it("out of office and autoresponders", () => {
    expect(kind({ From: "elena@larkspurhotel.example", Subject: "Re: Friday flowers?", "Auto-Submitted": "auto-replied" })).toBe("auto_reply");
    expect(kind({ From: "elena@larkspurhotel.example", Subject: "Automatic reply: Friday flowers?" })).toBe("auto_reply");
    expect(kind({ From: "elena@larkspurhotel.example", Subject: "Out of Office" })).toBe("auto_reply");
    expect(kind({ From: "elena@larkspurhotel.example", Subject: "Re: hi", "X-Autoreply": "yes" })).toBe("auto_reply");
    expect(kind({ From: "elena@larkspurhotel.example", Subject: "Re: hi", "Auto-Submitted": "no" })).toBe("human_reply");
  });
  it("delivery failures", () => {
    expect(kind({ From: "Mail Delivery Subsystem <mailer-daemon@googlemail.com>", Subject: "Delivery Status Notification (Failure)" })).toBe("delivery_failure");
    expect(kind({ From: "postmaster@hotel.example", Subject: "x" })).toBe("delivery_failure");
    expect(kind({ From: "x@hotel.example", "Content-Type": 'multipart/report; report-type=delivery-status; boundary="b"' })).toBe("delivery_failure");
  });
  it("bulk mail and the owner's own messages", () => {
    expect(kind({ From: "news@hotel.example", "List-Unsubscribe": "<mailto:u@hotel.example>" })).toBe("bulk");
    expect(kind({ From: "Nina <nina@flowers.example>", Subject: "Re: Friday flowers?" })).toBe("own_message");
    expect(kind({ From: "someone@else.example" }, ["SENT"])).toBe("own_message");
  });
  it("reads addresses and the Message-IDs a reply answers", () => {
    expect(addressOf("Elena Ruiz <Elena@LarkspurHotel.example>")).toBe("elena@larkspurhotel.example");
    expect(referencedMessageIds({ "In-Reply-To": "<ABC@gojoystick.com>", References: "<x@y> <abc@gojoystick.com>" })).toEqual(["<abc@gojoystick.com>", "<x@y>"]);
  });
});
