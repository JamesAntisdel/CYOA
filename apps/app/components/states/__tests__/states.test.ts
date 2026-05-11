/**
 * Type-level checks for the state surfaces. The runtime renders are exercised
 * by integration/e2e in a later wave; this module asserts the public surface
 * stays stable and that ShareModal's eligibility union is exhaustive.
 */
import type {
  ShareEligibility,
  ShareIneligibility,
} from "../../discovery/ShareModal";

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(`assert failed: ${message}`);
  }
}

// Exhaustiveness check over ShareIneligibility — adding a new variant without
// updating the modal copy will fail this switch at typecheck.
function describeReason(reason: ShareIneligibility): string {
  switch (reason) {
    case "guest_account":
      return "guest";
    case "private_tale":
      return "private";
    case "revoked":
      return "revoked";
    case "mature_blocked":
      return "mature";
    case "no_link":
      return "no_link";
    default: {
      const _exhaustive: never = reason;
      return _exhaustive;
    }
  }
}

export function runStatesTests(): void {
  const eligible: ShareEligibility = {
    eligible: true,
    shareUrl: "https://example.test/tale/abc",
  };
  const ineligible: ShareEligibility = {
    eligible: false,
    reason: "guest_account",
  };

  assert(eligible.eligible === true, "eligible variant carries shareUrl");
  assert(
    eligible.eligible && eligible.shareUrl.startsWith("https://"),
    "shareUrl is a URL",
  );
  assert(ineligible.eligible === false, "ineligible variant carries reason");
  assert(
    !ineligible.eligible && describeReason(ineligible.reason) === "guest",
    "describeReason maps guest_account",
  );

  // Cover every reason for the exhaustiveness check.
  const reasons: ShareIneligibility[] = [
    "guest_account",
    "private_tale",
    "revoked",
    "mature_blocked",
    "no_link",
  ];
  for (const r of reasons) {
    assert(describeReason(r).length > 0, `describeReason handles ${r}`);
  }
}

if (typeof require !== "undefined" && require.main === module) {
  runStatesTests();
  // eslint-disable-next-line no-console
  console.log("states tests passed");
}
