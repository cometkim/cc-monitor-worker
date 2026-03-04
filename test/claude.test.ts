import { describe, it, expect } from "vitest";
import {
  parseUserMetadata,
  type CCUserMetadata,
  parseUserAgent,
  type CCUserAgent,
} from "#src/claude/metadata.ts";

describe("parseUserMetadata", () => {
  it("should parse user metadata", () => {
    const result = parseUserMetadata({
      user_id: "user_4c2f7e237096b3f3ffddfeeca5ecbb89a00d7930db4519e207fd6b949a9b5c15_account_2e745e0f-3712-4359-a2da-f942a79ea77b_session_9b849125-251c-4211-bba9-1e3f579e2baf",
    });
    expect(result).toEqual<CCUserMetadata>({
      userId: "4c2f7e237096b3f3ffddfeeca5ecbb89a00d7930db4519e207fd6b949a9b5c15",
      userAccountId: "2e745e0f-3712-4359-a2da-f942a79ea77b",
      sessionId: "9b849125-251c-4211-bba9-1e3f579e2baf",
    });
  });

  it("should return null if no metadata is found", () => {
    const result = parseUserMetadata({});
    expect(result).toBeNull();
  });
});

describe("parseUserAgent", () => {
  it("should parse user agent string", () => {
    const result = parseUserAgent("claude-cli/2.1.63 (external, cli)");
    expect(result).toEqual<CCUserAgent>({
      name: "claude-cli",
      version: "2.1.63",
    });
  });

  it("should peak the first matching user agent", () => {
    const result = parseUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36");
    expect(result).toEqual<CCUserAgent>({
      name: "Mozilla",
      version: "5.0",
    });
  });

  it("should return unknown if no user agent is found", () => {
    const result = parseUserAgent("");
    expect(result).toEqual<CCUserAgent>({
      name: "unknown",
      version: "",
    });
  });
});
