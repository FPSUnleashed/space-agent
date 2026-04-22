import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

export const allowAnonymous = true;

const CURRENT_DIR = path.dirname(fileURLToPath(import.meta.url));
const SYSTEM_PROMPT_PATH = path.join(
  CURRENT_DIR, '..', '..', 'app', 'L0', '_all', 'mod', '_core',
  'onscreen_agent', 'prompts', 'system-prompt.md'
);

// Default to Z.AI (ZhipuAI) API
const DEFAULT_API_URL = 'https://api.z.ai/api/coding/paas/v4/chat/completions';
const DEFAULT_MODEL = 'glm-5.1';
const MAX_STEPS_HARD_LIMIT = 50;
const CODE_EXECUTION_TIMEOUT_MS = 30_000;
const LLM_REQUEST_TIMEOUT_MS = 120_000;

function createHttpError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function loadSystemPrompt() {
  try {
    return fs.readFileSync(SYSTEM_PROMPT_PATH, 'utf-8');
  } catch {
    return 'You are a browser runtime operator. Execute tasks by writing JavaScript code blocks.';
  }
}

function parseCodeBlocks(text) {
  const blocks = [];
  const lines = text.split('\n');
  let inBlock = false;
  let currentBlock = [];

  for (const line of lines) {
    if (line.includes('_____javascript')) {
      if (inBlock && currentBlock.length > 0) {
        blocks.push(currentBlock.join('\n'));
      }
      inBlock = true;
      currentBlock = [];
    } else if (inBlock) {
      if (line.trim() === '' && currentBlock.length > 0) {
        blocks.push(currentBlock.join('\n'));
        inBlock = false;
        currentBlock = [];
      } else {
        currentBlock.push(line);
      }
    }
  }

  if (inBlock && currentBlock.length > 0) {
    blocks.push(currentBlock.join('\n'));
  }

  return blocks;
}

async function executeCodeBlock(code, sandbox) {
  const context = vm.createContext(sandbox);
  // Wrap in async IIFE so top-level return/await work
  const wrappedCode = `(async () => {\n${code}\n})()`;
  const script = new vm.Script(wrappedCode, { filename: 'space-agent-task.js' });
  const result = await script.runInContext(context, { timeout: CODE_EXECUTION_TIMEOUT_MS });
  return result;
}

function createSandbox() {
  const output = [];
  const sandbox = {
    console: {
      log: (...args) => output.push(args.map(String).join(' ')),
      error: (...args) => output.push('[ERROR] ' + args.map(String).join(' ')),
      warn: (...args) => output.push('[WARN] ' + args.map(String).join(' ')),
    },
    setTimeout,
    clearTimeout,
    JSON,
    Math,
    Date,
    Array,
    Object,
    String,
    Number,
    Boolean,
    Error,
    Promise,
    parseInt,
    parseFloat,
    isNaN,
    isFinite,
    encodeURIComponent,
    decodeURIComponent,
    fetch: typeof globalThis.fetch !== 'undefined' ? globalThis.fetch : undefined,
    URL,
    URLSearchParams,
    Headers,
    Response: typeof globalThis.Response !== 'undefined' ? globalThis.Response : undefined,
    Request: typeof globalThis.Request !== 'undefined' ? globalThis.Request : undefined,
  };

  if (typeof TextEncoder !== 'undefined') sandbox.TextEncoder = TextEncoder;
  if (typeof TextDecoder !== 'undefined') sandbox.TextDecoder = TextDecoder;
  if (typeof Buffer !== 'undefined') sandbox.Buffer = Buffer;

  return { sandbox, output };
}

async function callLlm(apiUrl, apiKey, model, messages) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), LLM_REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        max_tokens: 4096,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => 'unknown error');
      throw createHttpError(
        `LLM API request failed (${response.status}): ${errorBody}`,
        response.status >= 500 ? 502 : 400
      );
    }

    const data = await response.json();

    // Handle both OpenAI and ZhipuAI response formats
    const content = data.choices?.[0]?.message?.content
      || data.choices?.[0]?.text
      || data.output?.text;

    if (!content) {
      throw createHttpError('Invalid LLM API response structure', 502);
    }

    return content;
  } finally {
    clearTimeout(timeoutId);
  }
}

function isTaskComplete(llmResponse, stepResults) {
  const blocks = parseCodeBlocks(llmResponse);
  return blocks.length === 0 && stepResults.length > 0;
}

export async function post(context) {
  const body = context.body && typeof context.body === 'object' ? context.body : {};

  const task = body.task;
  const apiKey = body.api_key;
  const model = body.model || DEFAULT_MODEL;
  const apiUrl = body.api_url || DEFAULT_API_URL;
  const maxSteps = Math.min(
    Math.max(Number(body.max_steps) || 10, 1),
    MAX_STEPS_HARD_LIMIT
  );

  if (!task || typeof task !== 'string' || task.trim().length === 0) {
    throw createHttpError('Missing or empty "task" field in request body.', 400);
  }

  if (!apiKey || typeof apiKey !== 'string' || apiKey.trim().length === 0) {
    throw createHttpError('Missing or empty "api_key" field in request body.', 400);
  }

  const systemPrompt = loadSystemPrompt();

  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: task },
  ];

  const stepLog = [];
  let finalResponse = '';
  let codeBlocksExecuted = 0;
  let stepsTaken = 0;

  for (let step = 0; step < maxSteps; step++) {
    stepsTaken++;
    console.log(`[task_run] Step ${step + 1}/${maxSteps}`);

    // Call the LLM
    const llmResponse = await callLlm(apiUrl, apiKey, model, messages);
    finalResponse = llmResponse;

    // Parse code blocks from the response
    const codeBlocks = parseCodeBlocks(llmResponse);

    if (codeBlocks.length === 0) {
      console.log(`[task_run] No code blocks found at step ${step + 1}, task complete.`);
      break;
    }

    // Execute each code block and collect results
    const executionResults = [];

    for (let i = 0; i < codeBlocks.length; i++) {
      const { sandbox, output } = createSandbox();
      const code = codeBlocks[i];

      console.log(`[task_run] Executing code block ${i + 1}/${codeBlocks.length} (${code.length} chars)`);

      let execResult;
      let execError = null;

      try {
        execResult = await executeCodeBlock(code, sandbox);
      } catch (err) {
        execError = err.message || String(err);
        console.error(`[task_run] Code block execution error: ${execError}`);
      }

      const result = {
        block_index: i,
        output: output.join('\n'),
        result: execResult !== undefined ? String(execResult) : undefined,
        error: execError,
      };

      executionResults.push(result);
      codeBlocksExecuted++;
      stepLog.push({
        step: step + 1,
        block: i + 1,
        ...result,
      });
    }

    // Feed the LLM response and execution results back into the conversation
    messages.push({ role: 'assistant', content: llmResponse });

    const resultSummary = executionResults
      .map((r, idx) => {
        const parts = [`Block ${idx + 1}:`];
        if (r.output) parts.push(`  Output: ${r.output}`);
        if (r.result !== undefined) parts.push(`  Result: ${r.result}`);
        if (r.error) parts.push(`  Error: ${r.error}`);
        return parts.join('\n');
      })
      .join('\n');

    messages.push({
      role: 'user',
      content: `Execution results:\n${resultSummary}\n\nContinue if needed, or provide your final answer.`,
    });

    // Check if the task appears complete
    if (isTaskComplete(llmResponse, stepLog)) {
      console.log(`[task_run] Task appears complete after step ${step + 1}.`);
      break;
    }
  }

  // Extract clean result text (minus code blocks)
  let resultText = finalResponse
    .split('\n')
    .filter(line => !line.includes('_____javascript'))
    .join('\n')
    .trim();

  if (!resultText) {
    resultText = 'Task completed.';
  }

  return {
    status: 200,
    body: {
      success: true,
      result: resultText,
      steps: stepsTaken,
      code_blocks_executed: codeBlocksExecuted
    }
  };
}
