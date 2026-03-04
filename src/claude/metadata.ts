import type { Metadata } from "@anthropic-ai/sdk/resources";

export interface CCUserMetadata {
  /** Hashed user ID */
  userId: string;

  /** Account UUID */
  userAccountId: string;

  /** Session UUID */
  sessionId: string;
}

export function parseUserMetadata(metadata: Metadata): CCUserMetadata | null {
  if (!metadata.user_id) return null;

  const parts = metadata.user_id.split("_");
  if (parts.length < 6) return null;

  const userIdx = parts.indexOf("user");
  const accountIdx = parts.indexOf("account");
  const sessionIdx = parts.indexOf("session");

  if (userIdx === -1 || accountIdx === -1 || sessionIdx === -1) return null;

  return {
    userId: parts[userIdx + 1],
    userAccountId: parts[accountIdx + 1],
    sessionId: parts[sessionIdx + 1]
  };
}

export interface CCUserAgent {
  name: string;
  version: string;
}

export function parseUserAgent(userAgent: string): CCUserAgent {
  const CC_UA_PATTERN = /^([^/]+)\/([^\s(]+)/;
  const match = userAgent.match(CC_UA_PATTERN);
  
  if (match) {
    return { name: match[1], version: match[2] };
  }
  
  return {
    name: userAgent.split("/")[0] || "unknown",
    version: "",
  };
}
