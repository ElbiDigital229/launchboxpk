// Shared logic: builds the Claude request from the user's answers.
// This is where the "intelligence" lives — keep it server-side so the
// prompt/IP and API key never reach the browser.
//
// NOTE: copied VERBATIM from the cv-tailor source (api/_prompt.js).
// Do not "simplify" the guardrails here — see docs/PRODUCT-DECISIONS.md.

const JSON_SHAPE = `{"name":"","title":"","contact":{"email":"","phone":"","location":"","linkedin":""},
"summary":"","experience":[{"title":"","org":"","location":"","dates":"","bullets":[""]}],
"competencies":[""],"systems":[""],"certifications":[""],
"education":[{"degree":"","school":"","year":""}],
"languages":[{"name":"","level":""}],"review_flags":[""]}`;

function buildPromptText(answers = {}) {
  const a = answers;
  const c = a.contact || {};
  return `Build a one-page, ATS-friendly resume as JSON for this candidate, tailored to the target role.

TARGET ROLE: ${a.role || "(not specified)"}
RELEVANT EXPERIENCE LEVEL: ${a.seniority || "(not specified)"}
LOCATION: ${a.location || ""}  | WORK PREFERENCE: ${a.workpref || ""}
CONTACT: name=${a.name || ""}; email=${c.email || ""}; phone=${c.phone || ""}; linkedin=${c.linkedin || ""}

JOB DESCRIPTION (may be empty):
${a.jd || "(none provided)"}

CANDIDATE EXPERIENCE (typed):
${a.experience || "(see uploaded CV if provided)"}

REAL NUMBERS / WINS THE CANDIDATE GAVE:
${a.numbers || "(none provided)"}

RULES (critical):
1. RIGHT-SIZE claim intensity to the experience level. For "Less than 1 year" or "1-2 years": keep achievements modest and activity-based; do NOT invent large company-wide quantified impact (e.g. "reduced turnover 22%") - it reads as implausible and gets junior candidates screened out.
2. Use ONLY information provided (typed answers + uploaded CV). Do NOT invent employers, titles, dates, certifications, or metrics. If a number wasn't given, write a strong activity statement instead of inventing one.
3. If a job description is present, mirror its real keywords ONLY where the candidate plausibly has that experience.
4. Reframe the candidate's background as an asset for the target role. Lead bullets with action + outcome.
5. Keep it to one page: 3-5 bullets for the most recent/most relevant role, 1-3 for others. Reverse-chronological by relevance.
6. Put any metric or claim you are not certain the candidate can defend into "review_flags" as a short reminder (e.g. "Confirm the '25+ hires' figure").

Return ONLY valid JSON, no markdown, with EXACTLY this shape:
${JSON_SHAPE}`;
}

// Assemble the Anthropic message content (text + optional CV file).
function buildContent(answers, file) {
  const content = [{ type: "text", text: buildPromptText(answers) }];
  if (file && file.b64) {
    if (file.type === "application/pdf") {
      content.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: file.b64 } });
    } else if (file.type && file.type.startsWith("image/")) {
      content.push({ type: "image", source: { type: "base64", media_type: file.type, data: file.b64 } });
    } else {
      try { content.push({ type: "text", text: "UPLOADED CV TEXT:\n" + Buffer.from(file.b64, "base64").toString("utf8") }); } catch (e) {}
    }
  }
  return content;
}

// Pull the JSON object out of Claude's response text.
function parseResumeJSON(apiData) {
  let text = (apiData.content || []).filter(b => b.type === "text").map(b => b.text).join("\n");
  text = text.replace(/```json/gi, "").replace(/```/g, "").trim();
  const s = text.indexOf("{"), e = text.lastIndexOf("}");
  if (s < 0 || e < 0) throw new Error("Model did not return valid JSON.");
  return JSON.parse(text.slice(s, e + 1));
}

module.exports = { buildPromptText, buildContent, parseResumeJSON };
