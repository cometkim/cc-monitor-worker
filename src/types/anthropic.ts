export interface AnthropicUsage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_creation?: AnthropicUsageCacheCreation;
}

export interface AnthropicUsageCacheCreation {
  ephemeral_5m_input_tokens: number;
  ephemeral_1h_input_tokens: number;
}

export interface AnthropicRequestMetadata {
  user_id?: string;
}

export interface AnthropicRequest {
  model: string;
  messages: unknown[];
  max_tokens: number;
  metadata?: AnthropicRequestMetadata;
  system?: string;
  stream?: boolean;
}

export interface AnthropicResponse {
  id: string;
  type: string;
  role: string;
  model: string;
  content: AnthropicContent[];
  stop_reason: string | null;
  stop_sequence: string | null;
  usage: AnthropicUsage;
}

export interface AnthropicContent {
  type: string;
  text?: string;
}

export interface AnthropicStreamingEvent {
  type: string;
  message?: AnthropicResponse;
  index?: number;
  content_block?: AnthropicContent;
  delta?: { type: string; text?: string; stop_reason?: string };
  usage?: AnthropicUsage;
}

export interface AnthropicErrorResponse {
  type: "error";
  error: {
    type: string;
    message: string;
  };
}
