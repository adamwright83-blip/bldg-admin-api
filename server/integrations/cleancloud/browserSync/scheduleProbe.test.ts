import { describe, expect, it, vi } from "vitest";
import {
  analyzeStorePage,
  isAuthenticatedStorePage,
  probeCleanCloudSchedule,
} from "./scheduleProbe";

const PAGE = `
<div id="online_page"><span id="pu_o_c">2</span></div>
<div id="awaiting_dc_pickup">
<table id="awaiting_dc_pickup_table">
<tr><th>ID</th><th></th><th>Customer</th><th></th><th>Contact</th><th></th><th></th><th>Notes</th><th>Pickup</th><th></th><th></th></tr>
<tr class="dcPickup_row" id="DCpickup_101"><td>101</td><td></td><td>Jane Private</td></tr>
<tr class="dcPickup_row" id="DCpickup_102"><td>102</td><td></td><td>John Private</td></tr>
</table></div>
<div id="awaiting_dc_delivery"></div>
<script>$.post("include/load_dc_deliveries.php"); $.get('/include/process_login_new.php');</script>`;

describe("CleanCloud schedule probe (read-only)", () => {
  it("reports structure and counts, never customer names", () => {
    const a = analyzeStorePage(PAGE);
    expect(a.pickups).toMatchObject({
      tableInPage: true,
      rowCount: 2,
      counterValue: 2,
      countMatchesCounter: true,
    });
    expect(a.pickups!.headers.slice(0, 3)).toEqual(["ID", "", "Customer"]);
    expect(a.deliveries!.candidateElementIds).toContain("awaiting_dc_delivery");
    expect(a.candidateEndpoints).toEqual(["include/load_dc_deliveries.php"]);
    expect(JSON.stringify(a)).not.toMatch(/Jane|John/);
  });

  it("logs in once, reads the store page once with GET, and returns findings", async () => {
    const login = vi.fn(async () => ({ cookieHeader: "s=1" }));
    const fetchImpl = vi.fn(
      async () => new Response(PAGE, { status: 200 })
    ) as unknown as typeof fetch;
    const report = await probeCleanCloudSchedule({
      tenantId: "t",
      login,
      fetchImpl,
      latestAttempt: null,
    });
    expect(login).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0]!;
    expect(url).toBe("https://cleancloudapp.com/store");
    expect((init as RequestInit).method).toBe("GET");
    expect(report.outcome).toBe("read");
    expect(report.findings[0]).toMatch(
      /2 rows, matching CleanCloud's own counter/
    );
  });

  it("refuses to log in after a recent auth failure until Gmail is reconnected", async () => {
    const now = new Date("2026-10-29T12:00:00Z");
    const failed = {
      outcome: "direct_auth_failed",
      createdAt: new Date("2026-10-29T02:06:00Z"),
    };
    const login = vi.fn(async () => ({ cookieHeader: "s=1" }));
    const refused = await probeCleanCloudSchedule({
      tenantId: "t",
      now,
      login,
      latestAttempt: failed,
      gmailConnectedAt: null,
    });
    expect(refused.outcome).toBe("refused");
    expect(login).not.toHaveBeenCalled();

    const fetchImpl = vi.fn(
      async () => new Response(PAGE, { status: 200 })
    ) as unknown as typeof fetch;
    const after = await probeCleanCloudSchedule({
      tenantId: "t",
      now,
      login,
      fetchImpl,
      latestAttempt: failed,
      gmailConnectedAt: new Date("2026-10-29T11:00:00Z"),
    });
    expect(after.outcome).toBe("read");
    expect(login).toHaveBeenCalledTimes(1);
  });

  it("a failed login is reported, never retried", async () => {
    const login = vi.fn(async () => {
      throw new Error(
        "CleanCloud email verification could not be completed: invalid_grant."
      );
    });
    const report = await probeCleanCloudSchedule({
      tenantId: "t",
      login,
      latestAttempt: null,
    });
    expect(report.outcome).toBe("login_failed");
    expect(report.message).toMatch(/invalid_grant/);
    expect(login).toHaveBeenCalledTimes(1);
  });

  it("a 200 login screen is not authenticated and concludes nothing about the pickup table", async () => {
    const loginPage = `<form action="include/process_login_new.php"><input name="login_email"><input type="password" name="login_password"></form>`;
    expect(isAuthenticatedStorePage(loginPage)).toBe(false);
    expect(isAuthenticatedStorePage(PAGE)).toBe(true);
    const report = await probeCleanCloudSchedule({
      tenantId: "t",
      login: async () => ({ cookieHeader: "s=1" }),
      fetchImpl: (async () =>
        new Response(loginPage, { status: 200 })) as unknown as typeof fetch,
      latestAttempt: null,
    });
    expect(report.outcome).toBe("not_authenticated");
    expect(report.pickups).toBeNull();
    expect(report.findings).toEqual([]);
  });
});
