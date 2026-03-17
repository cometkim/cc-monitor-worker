import type { MessageCreateParams, Metadata } from "@anthropic-ai/sdk/resources";

const ANTHROPIC_API_BASE = new URL("https://api.anthropic.com");

export type CCRequestContext =
  | CCRequestContextForAll
  | CCRequestContextForMessage

interface CCRequestContextBase {
  targetUrl: URL;

  userAgent: CCUserAgent;
  userEmail: string | null;

  /**
   * Not exsiting in the Anthropic's API requests. Should be injected manually.
   */
  organizationId: string | null;
}

export type CCRequestContextForAll = CCRequestContextBase & {
  target: "*";
};

// Should be validated before using
export type CCRequestContextForMessage = CCRequestContextBase & {
  target: "/v1/messages",
  userMetadata: CCUserMetadata | null;
  messageParams: MessageCreateParams,
};

export async function parseRequest(req: Request): Promise<CCRequestContext> {
  const url = new URL(req.url);
  const targetUrl = new URL(`${url.pathname.replace(/^\/proxy/, "")}${url.search}`, ANTHROPIC_API_BASE);

  const userEmail = req.headers.get("x-proxy-user-email");

  const rawUserAgent = req.headers.get("user-agent");
  const userAgent = parseUserAgent(rawUserAgent || "");

  const context: CCRequestContext = {
    target: "*",
    targetUrl,
    userAgent,
    userEmail,
    organizationId: null,
  };

  try {
    if (targetUrl.pathname === "/v1/messages") {
      const cloned = req.clone();
      const messageParams = await cloned.json() as MessageCreateParams;
      const userMetadata = messageParams.metadata
        ? parseUserMetadata(messageParams.metadata)
        : null;
      return {
        ...context,
        target: "/v1/messages",
        userMetadata,
        messageParams,
      };
    }
  } catch (error) {
    console.error({
      message: "Failed to parse user metadata from message request",
      cause: error instanceof Error ? error.message : (error as any).toString(),
    });
  }

  return context;
}

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
