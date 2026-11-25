const MAX_BODY_BYTES = 512 * 1024;
const CODE_LENGTH = 8;
const CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const BUILD_TTL_SECONDS = 30 * 24 * 60 * 60;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET, POST, OPTIONS",
      "access-control-allow-headers": "content-type"
    }
  });
}

function makeCode() {
  const bytes = new Uint8Array(CODE_LENGTH);
  crypto.getRandomValues(bytes);
  let code = "";
  for (const byte of bytes) {
    code += CODE_ALPHABET[byte % CODE_ALPHABET.length];
  }
  return code;
}

async function readRequestJson(request) {
  const declaredLength = Number(request.headers.get("content-length") || 0);
  if (declaredLength > MAX_BODY_BYTES) {
    throw new Error("PAYLOAD_TOO_LARGE");
  }

  const body = await request.text();
  if (new TextEncoder().encode(body).byteLength > MAX_BODY_BYTES) {
    throw new Error("PAYLOAD_TOO_LARGE");
  }

  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new Error("INVALID_JSON");
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("INVALID_BUILD");
  }
  return { body, parsed };
}

async function saveBuild(request, env) {
  if (!env.DB) return json({ error: "Database is not configured." }, 500);

  let body;
  try {
    ({ body } = await readRequestJson(request));
  } catch (error) {
    if (error.message === "PAYLOAD_TOO_LARGE") {
      return json({ error: "Build is too large. Maximum size is 512 KiB." }, 413);
    }
    if (error.message === "INVALID_JSON") {
      return json({ error: "Request body must be valid JSON." }, 400);
    }
    return json({ error: "Build must be a JSON object." }, 400);
  }

  const now = Math.floor(Date.now() / 1000);
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = makeCode();
    const result = await env.DB.prepare(
      "INSERT OR IGNORE INTO builds (code, payload, created_at, expires_at) VALUES (?, ?, ?, ?)"
    ).bind(code, body, now, now + BUILD_TTL_SECONDS).run();

    if (result.meta?.changes === 1) {
      return json({
        success: true,
        code,
        expiresAt: now + BUILD_TTL_SECONDS
      }, 201);
    }
  }

  return json({ error: "Could not allocate a build code. Please try again." }, 503);
}

async function getBuild(code, env) {
  if (!env.DB) return json({ error: "Database is not configured." }, 500);
  if (!new RegExp("^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{" + CODE_LENGTH + "}$").test(code)) {
    return json({ error: "Build code was not found." }, 404);
  }

  const now = Math.floor(Date.now() / 1000);
  const row = await env.DB.prepare(
    "SELECT payload, expires_at FROM builds WHERE code = ? AND expires_at > ?"
  ).bind(code, now).first();

  if (!row) {
    return json({ error: "Build code was not found or has expired." }, 404);
  }

  return new Response(row.payload, {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "access-control-allow-origin": "*"
    }
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-methods": "GET, POST, OPTIONS",
          "access-control-allow-headers": "content-type",
          "access-control-max-age": "86400"
        }
      });
    }

    if (request.method === "GET" && url.pathname === "/") {
      return json({
        service: "Independent F3X Import / Export API",
        status: "online",
        endpoints: ["POST /api/builds", "GET /api/builds/:code"]
      });
    }

    if (request.method === "POST" && url.pathname === "/api/builds") {
      return saveBuild(request, env);
    }

    const match = url.pathname.match(/^\/api\/builds\/([^/]+)$/);
    if (request.method === "GET" && match) {
      return getBuild(match[1].toUpperCase(), env);
    }

    return json({ error: "Route not found." }, 404);
  }
};
