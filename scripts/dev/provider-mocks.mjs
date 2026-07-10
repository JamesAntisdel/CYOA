import http from "node:http";
import { URL } from "node:url";

const port = Number(process.env.PROVIDER_MOCKS_PORT ?? 4010);
const mode = process.env.MOCK_PROVIDER_MODE ?? "ok";
const forcedStatus = Number(process.env.MOCK_PROVIDER_STATUS ?? 0);

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      if (!body) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function extractPromptText(request) {
  return (
    request?.prompt ??
    request?.messages?.at?.(-1)?.content ??
    request?.contents?.at?.(-1)?.parts?.at?.(0)?.text ??
    ""
  );
}

function isLlmDrivenPrompt(request) {
  const prompt = String(extractPromptText(request));
  // The llm-driven prompt explicitly demands a single JSON object with prose,
  // choices, and terminal — and the provider config also requests JSON mode
  // via responseMimeType for Gemini. Either signal flips us to JSON output.
  if (prompt.includes('"choices": Choice[]')) return true;
  if (request?.generationConfig?.responseMimeType === "application/json") return true;
  return false;
}

function llmDrivenJsonText(provider, request) {
  const seed = String(extractPromptText(request)).slice(0, 240) || "A quiet local page.";
  return JSON.stringify({
    prose:
      `[${provider}:mock] The page holds steady. ${seed.split("\n")[0]}\n\nThe local provider mock has stitched a deterministic two-beat scene so the reader can take a turn without a real model call.`,
    choices: [
      {
        id: "step-forward",
        label: "Step forward into the next beat.",
        tone: "bold",
        effects: [{ kind: "flag_set", flag: "mock_stepped_forward", value: true }],
      },
      {
        id: "watch-shadows",
        label: "Watch the shadows for one breath more.",
        tone: "careful",
        effects: [{ kind: "stat", statId: "resolve", delta: 1 }],
      },
    ],
    terminal: null,
  });
}

function completionText(provider, request) {
  if (isLlmDrivenPrompt(request)) {
    return llmDrivenJsonText(provider, request);
  }
  const seed = extractPromptText(request) || "The page waits at a local development boundary.";
  return `[${provider}:mock] ${String(seed).slice(0, 240)}\n\nThe scene continues deterministically without a paid provider call.`;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

  if (url.pathname === "/health") {
    json(res, 200, {
      ok: true,
      mode,
      services: ["anthropic", "deepseek", "vertex", "stripe-placeholder"],
    });
    return;
  }

  if (mode === "fail" || forcedStatus >= 400) {
    json(res, forcedStatus || 503, {
      error: {
        type: "mock_provider_failure",
        message: "Forced local provider mock failure.",
      },
    });
    return;
  }

  let request;
  try {
    request = await readBody(req);
  } catch {
    json(res, 400, { error: { type: "invalid_json", message: "Request body must be JSON." } });
    return;
  }

  if (url.pathname.includes("anthropic") || url.pathname.endsWith("/v1/messages")) {
    json(res, 200, {
      id: "msg_cyoa_local_mock",
      type: "message",
      role: "assistant",
      model: request.model ?? "claude-local-mock",
      content: [{ type: "text", text: completionText("anthropic", request) }],
      usage: { input_tokens: 32, output_tokens: 48 },
    });
    return;
  }

  if (url.pathname.includes("deepseek") || url.pathname.endsWith("/chat/completions")) {
    json(res, 200, {
      id: "chatcmpl_cyoa_local_mock",
      object: "chat.completion",
      model: request.model ?? "deepseek-local-mock",
      choices: [{ index: 0, message: { role: "assistant", content: completionText("deepseek", request) } }],
      usage: { prompt_tokens: 32, completion_tokens: 48, total_tokens: 80 },
    });
    return;
  }

  if (url.pathname.includes("vertex") || url.pathname.includes(":generateContent")) {
    json(res, 200, {
      candidates: [
        {
          content: {
            role: "model",
            parts: [{ text: completionText("vertex", request) }],
          },
          finishReason: "STOP",
        },
      ],
      usageMetadata: { promptTokenCount: 32, candidatesTokenCount: 48, totalTokenCount: 80 },
    });
    return;
  }

  if (url.pathname.includes("stripe")) {
    json(res, 200, {
      id: "evt_cyoa_local_mock",
      object: "event",
      type: "checkout.session.completed",
      livemode: false,
      data: { object: { id: "cs_test_cyoa_local_mock" } },
    });
    return;
  }

  json(res, 404, {
    error: {
      type: "unknown_mock_route",
      message: "Use /health, /v1/messages, /chat/completions, /vertex/:generateContent, or /stripe/events.",
    },
  });
});

server.listen(port, "0.0.0.0", () => {
  console.log(`CYOA provider mocks listening on http://0.0.0.0:${port}`);
});
