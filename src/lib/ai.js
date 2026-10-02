import { getSettings } from "./kv.js";

function configFor(settings, purpose) {
  const provider = purpose === "receipt" ? settings.receipt_ai_provider : settings.support_ai_provider;
  const base = purpose === "receipt" ? settings.receipt_ai_base_url : settings.support_ai_base_url;
  const model = purpose === "receipt" ? settings.receipt_ai_model : settings.support_ai_model;
  const key = provider === "llm7" ? settings.llm7_api_key : settings.groq_api_key;
  return { provider, base: (base || "").replace(/\/+$/, ""), model, key };
}

export async function aiChat(env, messages, purpose = "support", extra = {}) {
  const settings = await getSettings(env.BOT_KV);
  const cfg = configFor(settings, purpose);
  if (!cfg.key || !cfg.base || !cfg.model) throw new Error("AI is not configured");
  const payload = {
    model: cfg.model,
    messages,
    temperature: extra.temperature ?? 0,
    max_completion_tokens: extra.max_completion_tokens ?? extra.max_tokens ?? (purpose === "receipt" ? 700 : 500),
    ...(purpose === "receipt" && cfg.provider === "groq"
      ? {
          response_format: { type: "json_object" },
          reasoning_effort: "none",
        }
      : {}),
  };
  // Never let a receipt/support request hang the Worker for minutes.
  // Cloudflare will abort the upstream request after the configured timeout.
  const timeoutMs = Number(extra.timeout_ms || (purpose === "receipt" ? 25000 : 15000));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort("AI request timeout"), timeoutMs);
  let res;
  try {
    res = await fetch(`${cfg.base}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg.key}` },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } catch (e) {
    if (e?.name === "AbortError" || String(e).toLowerCase().includes("timeout")) {
      throw new Error(`AI timeout after ${timeoutMs}ms`);
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    let detail = "";
    try {
      const errData = await res.json();
      detail = errData?.error?.message || errData?.message || "";
    } catch {}
    throw new Error(`AI HTTP ${res.status}${detail ? `: ${detail.slice(0, 300)}` : ""}`);
  }
  const data = await res.json();
  return data?.choices?.[0]?.message?.content || "";
}

export async function analyzeReceipt(env, { imageDataUrl, expected }) {
  const settings = await getSettings(env.BOT_KV);
  if (!settings.receipt_ai_enabled) return { decision: "review", reason: "receipt AI disabled" };
  const prompt = `Analyze this payment receipt image for a Persian Telegram shop.
Return ONLY valid JSON:
{"decision":"approve|reject|review","confidence":0.0,"amount":number|null,"card_last4":string|null,"date":string|null,"reference":string|null,"related":true|false,"reason":string}
Rules:
- approve only when the receipt is clearly a payment receipt, amount exactly matches expected amount, and source card last4 exactly matches expected card last4 (if provided).
- reject when clearly unrelated to a payment receipt (for example a random photo, meme, person, landscape, product photo, screenshot unrelated to payment), fake-looking/obviously invalid, wrong amount, or wrong last4.
- If the image is clearly NOT a payment receipt, set related=false and decision=reject.
- review only when it is plausibly a real payment receipt but is blurry, fields are missing, ambiguous, or there is meaningful uncertainty.
Expected amount: ${expected.amount}
Expected card last4: ${expected.card_last4 || "not provided"}
Expected card holder: ${expected.card_holder || "unknown"}
Expected shop card: ${expected.shop_card || "unknown"}
Do not infer missing data.`;
  const content = await aiChat(env, [{
    role: "user",
    content: [
      { type: "text", text: prompt },
      { type: "image_url", image_url: { url: imageDataUrl } },
    ],
  }], "receipt", { temperature: 0, max_completion_tokens: 500 });
  try {
    const cleaned = content.replace(/```json|```/g, "").trim();
    const result = JSON.parse(cleaned);
    if (!["approve","reject","review"].includes(result.decision)) result.decision = "review";
    // A clearly unrelated image must never be escalated to manual approval.
    if (result.related === false) result.decision = "reject";
    return result;
  } catch {
    return { decision: "review", confidence: 0, reason: "AI returned invalid structured output", raw: content.slice(0, 1000) };
  }
}

export async function supportReply(env, userText, context = "") {
  const settings = await getSettings(env.BOT_KV);
  const system = `${settings.ai_system_prompt || ""}\nCurrent shop context:\n${context}`;
  return aiChat(env, [
    { role: "system", content: system },
    { role: "user", content: userText },
  ], "support", { temperature: 0.2, max_completion_tokens: 500 });
}

export async function downloadTelegramImage(env, telegram, fileId) {
  const info = await telegram.getFile(fileId);
  if (!info.ok || !info.result?.file_path) throw new Error("Telegram file unavailable");
  const url = `https://api.telegram.org/file/bot${env.BOT_TOKEN}/${info.result.file_path}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort("Telegram file timeout"), 15000);
  let res;
  try {
    res = await fetch(url, { signal: controller.signal });
  } catch (e) {
    throw new Error(`Telegram image download timeout/failed: ${e?.message || e}`);
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw new Error("Telegram image download failed");
  const blob = await res.blob();
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  const base64 = btoa(binary);
  const mime = blob.type || "image/jpeg";
  return `data:${mime};base64,${base64}`;
}
