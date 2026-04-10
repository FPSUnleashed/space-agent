import * as config from "/mod/_core/onscreen_agent/config.js";
import * as llmParams from "/mod/_core/onscreen_agent/llm-params.js";
import { prepareOnscreenAgentCompletionRequest } from "/mod/_core/onscreen_agent/llm.js";
import { mergeConsecutiveChatMessages } from "/mod/_core/framework/js/chat-messages.js";
import { getHuggingFaceManager } from "/mod/_core/huggingface/manager.js";

function extractTextContent(value) {
  if (typeof value === "string") {
    return value;
  }

  if (!Array.isArray(value)) {
    return "";
  }

  return value
    .map((part) => {
      if (typeof part === "string") {
        return part;
      }

      if (part && typeof part.text === "string") {
        return part.text;
      }

      return "";
    })
    .join("");
}

function extractStreamingDelta(payload) {
  const choice = payload.choices?.[0];

  if (!choice) {
    return "";
  }

  const delta = choice.delta || choice.message || {};
  return extractTextContent(delta.content || choice.text || "");
}

function extractNonStreamingMessage(payload) {
  const choice = payload.choices?.[0];

  if (!choice) {
    return "";
  }

  const message = choice.message || {};
  return extractTextContent(message.content || choice.text || "");
}

function createCompletionResponseMeta(mode) {
  return {
    finishReason: "",
    mode,
    payloadCount: 0,
    protocolObserved: false,
    sawDoneMarker: false,
    textChunkCount: 0,
    verifiedEmpty: false
  };
}

function noteCompletionPayload(meta, payload, textChunk = "") {
  meta.payloadCount += 1;

  const finishReason = payload?.choices?.[0]?.finish_reason;

  if (!meta.finishReason && typeof finishReason === "string" && finishReason) {
    meta.finishReason = finishReason;
  }

  if (typeof textChunk === "string" && textChunk.trim()) {
    meta.textChunkCount += 1;
  }
}

function finalizeCompletionResponseMeta(meta) {
  const protocolObserved = meta.mode === "standard" ? meta.payloadCount > 0 : meta.payloadCount > 0 || meta.sawDoneMarker;

  return {
    ...meta,
    protocolObserved,
    verifiedEmpty: protocolObserved && meta.textChunkCount === 0
  };
}

async function throwResponseError(response) {
  const contentType = response.headers.get("content-type") || "";
  let detail = "";

  if (contentType.includes("application/json")) {
    try {
      const payload = await response.json();
      detail = payload.error?.message || payload.error || JSON.stringify(payload);
    } catch {
      detail = "Unable to parse JSON error body.";
    }
  } else {
    detail = await response.text();
  }

  throw new Error(`Chat request failed with status ${response.status}: ${detail || response.statusText}`);
}

async function readStandardResponse(response, onDelta) {
  const meta = createCompletionResponseMeta("standard");
  const payload = await response.json();
  const message = extractNonStreamingMessage(payload);

  noteCompletionPayload(meta, payload, message);

  if (message) {
    onDelta(message);
  }

  return finalizeCompletionResponseMeta(meta);
}

function parseEventBlock(eventBlock, onDelta, meta) {
  const lines = eventBlock.split(/\r?\n/u);

  for (const line of lines) {
    if (!line.startsWith("data:")) {
      continue;
    }

    const value = line.slice(5).trim();

    if (!value) {
      continue;
    }

    if (value === "[DONE]") {
      meta.sawDoneMarker = true;
      return true;
    }

    const payload = JSON.parse(value);
    const delta = extractStreamingDelta(payload);

    noteCompletionPayload(meta, payload, delta);

    if (delta) {
      onDelta(delta);
    }
  }

  return false;
}

async function readStreamingResponse(response, onDelta) {
  const meta = createCompletionResponseMeta("stream");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), {
      stream: !done
    });

    let boundary = buffer.indexOf("\n\n");

    while (boundary !== -1) {
      const eventBlock = buffer.slice(0, boundary).trim();
      buffer = buffer.slice(boundary + 2);

      if (eventBlock && parseEventBlock(eventBlock, onDelta, meta)) {
        return finalizeCompletionResponseMeta(meta);
      }

      boundary = buffer.indexOf("\n\n");
    }

    if (done) {
      const remaining = buffer.trim();

      if (remaining) {
        parseEventBlock(remaining, onDelta, meta);
      }

      return finalizeCompletionResponseMeta(meta);
    }
  }
}

function normalizeCompletionMessagesForLocal(messages) {
  const mergedMessages = mergeConsecutiveChatMessages(Array.isArray(messages) ? messages : []);

  return mergedMessages
    .map((message) => {
      const role =
        message?.role === "system"
          ? "system"
          : message?.role === "assistant"
            ? "assistant"
            : message?.role === "user"
              ? "user"
              : "";
      const content = extractTextContent(message?.content || "");

      if (!role || !content.trim()) {
        return null;
      }

      return {
        content,
        role
      };
    })
    .filter(Boolean);
}

export class OnscreenAgentLlmClient {
  constructor(options = {}) {
    this.settings =
      options.settings && typeof options.settings === "object"
        ? options.settings
        : config.DEFAULT_ONSCREEN_AGENT_SETTINGS;
  }

  async resolvePreparedRequest(options = {}) {
    if (options.preparedRequest && typeof options.preparedRequest === "object") {
      return options.preparedRequest;
    }

    const promptOptions =
      options.promptOptions && typeof options.promptOptions === "object"
        ? options.promptOptions
        : {
            localProfile:
              config.normalizeOnscreenAgentLlmProvider(this.settings.provider) ===
              config.ONSCREEN_AGENT_LLM_PROVIDER.LOCAL
          };

    return prepareOnscreenAgentCompletionRequest({
      messages: options.messages,
      options: promptOptions,
      promptInput: options.promptInput,
      settings: this.settings,
      systemPrompt: options.systemPrompt
    });
  }

  async streamCompletion() {
    throw new Error("LLM client subclasses must implement streamCompletion().");
  }
}

export class OnscreenAgentApiLlmClient extends OnscreenAgentLlmClient {
  validateSettings(settings = this.settings) {
    if (!settings?.apiEndpoint?.trim()) {
      throw new Error("Set an API endpoint before sending a message.");
    }

    if (!settings.apiKey.trim()) {
      throw new Error("Set an API key before sending a message.");
    }

    if (!settings.model.trim()) {
      throw new Error("Set a model before sending a message.");
    }
  }

  async streamCompletion(options = {}) {
    const onDelta = typeof options.onDelta === "function" ? options.onDelta : () => {};
    const effectiveRequest = await this.resolvePreparedRequest(options);
    const effectiveSettings =
      effectiveRequest?.settings && typeof effectiveRequest.settings === "object"
        ? effectiveRequest.settings
        : this.settings;

    this.validateSettings(effectiveSettings);

    const response = await fetch(effectiveRequest.requestUrl, {
      method: "POST",
      headers: effectiveRequest.headers,
      body: JSON.stringify(effectiveRequest.requestBody),
      signal: options.signal
    });

    if (!response.ok) {
      await throwResponseError(response);
    }

    const contentType = response.headers.get("content-type") || "";

    if (!contentType.includes("text/event-stream")) {
      return readStandardResponse(response, onDelta);
    }

    if (!response.body) {
      throw new Error("Streaming response body is not available.");
    }

    return readStreamingResponse(response, onDelta);
  }
}

export class OnscreenAgentLocalLlmClient extends OnscreenAgentLlmClient {
  validateSettings(settings = this.settings) {
    const selection = config.getOnscreenAgentLocalModelSelection(settings);

    if (selection.provider !== config.ONSCREEN_AGENT_LOCAL_PROVIDER.HUGGINGFACE) {
      throw new Error("Choose a supported local LLM provider.");
    }

    if (!selection.modelId.trim()) {
      throw new Error("Choose a Hugging Face model before sending a message.");
    }

    if (!selection.dtype.trim()) {
      throw new Error("Choose a Hugging Face dtype before sending a message.");
    }
  }

  getCompletionMessages(preparedRequest) {
    const requestBodyMessages = Array.isArray(preparedRequest?.requestBody?.messages)
      ? preparedRequest.requestBody.messages
      : [];
    const requestMessages = Array.isArray(preparedRequest?.messages) ? preparedRequest.messages : [];

    return normalizeCompletionMessagesForLocal(requestBodyMessages.length ? requestBodyMessages : requestMessages);
  }

  async streamCompletion(options = {}) {
    const onDelta = typeof options.onDelta === "function" ? options.onDelta : () => {};
    const effectiveRequest = await this.resolvePreparedRequest(options);
    const effectiveSettings =
      effectiveRequest?.settings && typeof effectiveRequest.settings === "object"
        ? effectiveRequest.settings
        : this.settings;

    this.validateSettings(effectiveSettings);

    const result = await getHuggingFaceManager().streamCompletion({
      messages: this.getCompletionMessages(effectiveRequest),
      modelSelection: config.getOnscreenAgentLocalModelSelection(effectiveSettings),
      onDelta,
      requestOptions: llmParams.parseOnscreenAgentParamsText(effectiveSettings.paramsText || ""),
      signal: options.signal
    });

    return result.responseMeta;
  }
}

export function createOnscreenAgentLlmClient(settings = config.DEFAULT_ONSCREEN_AGENT_SETTINGS) {
  const provider = config.normalizeOnscreenAgentLlmProvider(settings?.provider);

  if (provider === config.ONSCREEN_AGENT_LLM_PROVIDER.LOCAL) {
    return new OnscreenAgentLocalLlmClient({
      settings
    });
  }

  return new OnscreenAgentApiLlmClient({
    settings
  });
}

export const streamOnscreenAgentCompletion = globalThis.space.extend(
  import.meta,
  async function streamOnscreenAgentCompletion({
    messages,
    onDelta,
    preparedRequest,
    promptOptions,
    promptInput,
    settings,
    signal,
    systemPrompt
  }) {
    const normalizedSettings =
      settings && typeof settings === "object" ? settings : preparedRequest?.settings;
    const client = createOnscreenAgentLlmClient(normalizedSettings);

    return client.streamCompletion({
      messages,
      onDelta,
      preparedRequest,
      promptOptions,
      promptInput,
      signal,
      systemPrompt
    });
  }
);
