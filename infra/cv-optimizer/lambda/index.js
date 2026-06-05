// AWS Lambda handler  ->  POST /api/generate  (behind API Gateway HTTP API v2)
//
// This reuses the EXACT prompt logic from the cv-tailor source (_prompt.js:
// buildContent + parseResumeJSON) and the same Anthropic call as the original
// Vercel route (api/generate.js). Only the handler signature is adapted to the
// Lambda / API Gateway event+response shape.
//
// Required env var: ANTHROPIC_API_KEY  (set on the Lambda, NEVER committed,
// NEVER sent to the browser).

const { buildContent, parseResumeJSON } = require("./_prompt");

const MODEL = "claude-sonnet-4-20250514";

// CORS headers. With the same-origin CloudFront /api/* behavior these are
// unnecessary, but they make the endpoint safe to call cross-origin too
// (e.g. local dev, or a fallback direct-to-API-Gateway setup).
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function reply(statusCode, obj) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json", ...CORS },
    body: JSON.stringify(obj),
  };
}

// HTTP API (payload format 2.0) exposes the method at requestContext.http.method;
// fall back to the v1 shape just in case the API is configured as REST/v1.
function getMethod(event) {
  return (
    (event.requestContext && event.requestContext.http && event.requestContext.http.method) ||
    event.httpMethod ||
    "POST"
  );
}

function getBody(event) {
  let raw = event.body || "{}";
  if (event.isBase64Encoded) {
    raw = Buffer.from(raw, "base64").toString("utf8");
  }
  return typeof raw === "string" ? JSON.parse(raw || "{}") : raw || {};
}

exports.handler = async function handler(event) {
  const method = getMethod(event);

  // CORS preflight (only fires when called cross-origin).
  if (method === "OPTIONS") {
    return { statusCode: 204, headers: CORS, body: "" };
  }
  if (method !== "POST") {
    return reply(405, { error: "Method not allowed" });
  }

  try {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) return reply(500, { error: "Server missing ANTHROPIC_API_KEY." });

    const body = getBody(event);
    const { answers = {}, file = null } = body;

    const content = buildContent(answers, file);

    const apiRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({ model: MODEL, max_tokens: 4000, messages: [{ role: "user", content }] }),
    });

    if (!apiRes.ok) {
      const t = await apiRes.text();
      return reply(502, { error: "Upstream error: " + apiRes.status, detail: t.slice(0, 300) });
    }

    const data = await apiRes.json();
    const resume = parseResumeJSON(data);
    return reply(200, { data: resume });
  } catch (err) {
    return reply(500, { error: (err && err.message) || "Generation failed." });
  }
};
