import { describe, expect, it } from "vitest";
import { openWorkspace } from "./WorkspaceKey";

describe("opening the workspace from the table", () => {
  it("creates the password once; a retry after a failed sign-in only signs in", async () => {
    const calls: string[] = [];
    let activated = false;
    let signInWorks = false;
    const attempt = () =>
      openWorkspace({
        activated,
        activate: async () => void calls.push("activate"),
        onActivated: () => (activated = true),
        signIn: async () => {
          calls.push("sign in");
          if (!signInWorks) throw new Error("Signing in didn't work.");
        },
      });
    await expect(attempt()).rejects.toThrow("Signing in didn't work.");
    expect(activated).toBe(true);
    signInWorks = true;
    await attempt();
    expect(calls).toEqual(["activate", "sign in", "sign in"]);
  });

  it("doesn't sign in, or count the password as set, when creating it fails", async () => {
    let activated = false;
    let signedIn = false;
    await expect(
      openWorkspace({
        activated,
        activate: async () => {
          throw new Error("That password couldn't be saved.");
        },
        onActivated: () => (activated = true),
        signIn: async () => void (signedIn = true),
      })
    ).rejects.toThrow("couldn't be saved");
    expect(activated).toBe(false);
    expect(signedIn).toBe(false);
  });
});
