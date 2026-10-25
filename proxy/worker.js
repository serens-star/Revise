/*
 * Revise: proxy (Cloudflare Worker)
 * ---------------------------------------------------------------
 * WHY THIS EXISTS
 * Calling the Anthropic API straight from the browser puts the API key in the
 * page source. This Worker holds the key on the server instead. The page sends
 * its request here, the Worker adds the key and forwards it to Anthropic, and
 * the reply comes back unchanged.
 *
 * WHAT IT PROTECTS
 * - The key is never sent to the browser.
 * - The model and the reply length are fixed here, so the page cannot change them.
 * - Oversized requests are refused.
 *
 * WHAT IT DOES NOT PROTECT
 * Anyone who finds this URL can send a short request through it. The damage is
 * capped by the prepaid balance on the key (keep auto-reload off) and the
 * 300-token reply limit below.
 *
 * SETTINGS (set in the Cloudflare dashboard, never in this file)
 *   ANTHROPIC_API_KEY  required, as a Secret
 *   ALLOWED_ORIGIN     optional, as a plain variable. For example
 *                      https://yourname.github.io  If it is not set, any site
 *                      (and a page opened from disk) may call this Worker.
 *   MODEL              optional, as a plain variable. Defaults to the line below.
 */

const DEFAULT_MODEL = "claude-haiku-5-5";
const MAX_TOKENS = 300;
const MAX_BODY_CHARS = 12000;

export default {
  async fetch(request, env) {
    const allowed = env.ALLOWED_ORIGIN || "*";
    const cors = {
      "Access-Control-Allow-Origin": allowed,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "content-type",
      Vary: "Origin",
    };
    const reply = (obj, status) =>
      new Response(JSON.stringify(obj), {
        status,
        headers: { ...cors, "content-type": "application/json" },
      });

    // Browsers ask permission first with an OPTIONS request.
    if (request.method === "OPTIONS")
      return new Response(null, { status: 204, headers: cors });
    if (request.method !== "POST") return reply({ error: "Use POST." }, 405);

    if (allowed !== "*" && request.headers.get("Origin") !== allowed) {
      return reply({ error: "This origin is not allowed." }, 403);
    }
    if (!env.ANTHROPIC_API_KEY)
      return reply({ error: "The server has no API key set." }, 500);

    // Read and check the request.
    const raw = await request.text();
    if (raw.length > MAX_BODY_CHARS)
      return reply({ error: "Request too large." }, 413);

    let body;
    try {
      body = JSON.parse(raw);
    } catch {
      return reply({ error: "Request was not valid JSON." }, 400);
    }

    const message = Array.isArray(body.messages) ? body.messages[0] : null;
    if (
      typeof body.system !== "string" ||
      !message ||
      message.role !== "user" ||
      typeof message.content !== "string"
    ) {
      return reply(
        { error: "Request is missing a system prompt or a user message." },
        400
      );
    }

    // Forward to Anthropic. Model and length come from here, not from the page.
    const upstream = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: env.MODEL || DEFAULT_MODEL,
        max_tokens: MAX_TOKENS,
        system: body.system,
        messages: [{ role: "user", content: message.content }],
      }),
    });

    return new Response(upstream.body, {
      status: upstream.status,
      headers: { ...cors, "content-type": "application/json" },
    });
  },
};
