import { describe, expect, it } from "vitest";
import { unknownValue } from "../../shared/businessGame";

describe("TEAM truth boundaries",()=>{
  it("keeps owner-independent revenue unknown without job executor evidence",()=>{
    const value=unknownValue<number>("Sales assignment is not production execution");
    expect(value.value).toBeNull();
    expect(value.provenance).toBe("UNKNOWN");
  });
});
