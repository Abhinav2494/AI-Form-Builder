import { GoogleGenAI } from "@google/genai";
import { env } from "../config/env.js";
import { ApiError } from "../utils/ApiError.js";

let client = null;

function getClient() {
  if (!env.gemini.apiKey) {
    throw ApiError.badRequest(
      "AI is not configured. Set GEMINI_API_KEY in the backend .env to enable AI features."
    );
  }
  if (!client) {
    client = new GoogleGenAI({ apiKey: env.gemini.apiKey });
  }
  return client;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function isRetryable(err) {
  const status = Number(err.status ?? err.code);
  return (
    [429, 500, 503, 504].includes(status) ||
    /UNAVAILABLE|high demand|overloaded/i.test(err.message || "")
  );
}

// Tries the main model (twice if it is busy), then the fallback model.
async function callGemini(ai, { contents, config }) {
  const models = [env.gemini.model, env.gemini.fallbackModel].filter(Boolean);
  let lastErr;
  for (const model of models) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return await ai.models.generateContent({
          model,
          contents,
          config: { ...config, httpOptions: { timeout: 40000 } },
        });
      } catch (err) {
        lastErr = err;
        if (!isRetryable(err)) break; // not a busy error: move to the next model
        await sleep(1500 * (attempt + 1)); // busy: wait, then retry
      }
    }
  }
  throw lastErr;
}

function aiError(err) {
  if (isRetryable(err)) {
    return new ApiError(503, "The AI service is busy right now. Please try again in a moment.");
  }
  return ApiError.internal(`AI request failed: ${err.message}`);
}

export async function generateJson(prompt, { schemaHint = "" } = {}) {
  const ai = getClient();

  const fullPrompt = `${prompt}

${schemaHint ? `Return ONLY valid minified JSON matching this shape:\n${schemaHint}` : ""}
Do not include markdown code fences or any prose. Output JSON only.`;

  let text;
  try {
    const result = await callGemini(ai, {
      contents: fullPrompt,
      config: {
        responseMimeType: "application/json",
        temperature: 0.7,
        thinkingConfig: { thinkingLevel: "low" },
      },
    });
    text = result.text;
  } catch (err) {
    throw aiError(err);
  }

  return parseJson(text);
}

export async function generateText(prompt) {
  const ai = getClient();
  try {
    const result = await callGemini(ai, {
      contents: prompt,
      config: {
        temperature: 0.7,
        thinkingConfig: { thinkingLevel: "low" },
      },
    });
    return result.text?.trim() || "";
  } catch (err) {
    throw aiError(err);
  }
}

function parseJson(raw) {
  if (!raw) throw ApiError.internal("AI returned an empty response");
  let cleaned = raw.trim();

  cleaned = cleaned.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();

  const firstBrace = cleaned.search(/[{[]/);
  const lastBrace = Math.max(cleaned.lastIndexOf("}"), cleaned.lastIndexOf("]"));
  if (firstBrace !== -1 && lastBrace !== -1) {
    cleaned = cleaned.slice(firstBrace, lastBrace + 1);
  }
  try {
    return JSON.parse(cleaned);
  } catch {
    throw ApiError.internal("AI returned malformed JSON. Please try again.");
  }
}