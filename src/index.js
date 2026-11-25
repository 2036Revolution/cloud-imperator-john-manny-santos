const MAX_BODY_BYTES = 512 * 1024;
const CODE_LENGTH = 4;
const CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const CODE_CAPACITY = CODE_ALPHABET.length ** CODE_LENGTH;
const NEVER_EXPIRES = 253402300799;
const BLOCKED_CODE_FRAGMENTS = ["FUCK", "CUNT", "SHIT", "PISS", "TWAT", "CRAP", "DICK", "COCK", "PORN", "ANAL", "RAPE", "FAG", "KYS", "ASS"];
const REQUIRED_GROUP_ID = 10608653;
const MEMBERSHIP_CACHE_SECONDS = 30 * 60;
const TIMESTAMP_TOLERANCE_SECONDS = 120;
const USER_REQUESTS_PER_MINUTE = 12;
const IP_REQUESTS_PER_MINUTE = 30;

function corsHeaders() {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type, x-roblox-userid, x-request-timestamp, x-request-nonce",
    "access-control-max-age": "86400"
  };
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...corsHeaders()
    }
  });
}

function makeCode() {
  const bytes = new Uint8Array(CODE_LENGTH);
  crypto.getRandomValues(bytes);
  let code = "";
  for (const byte of bytes) code += CODE_ALPHABET[byte % CODE_ALPHABET.length];
  if (BLOCKED_CODE_FRAGMENTS.some(fragment => code.includes(fragment))) return null;
  return code;
}

async function readRequestJson(request) {
  const declaredLength = Number(request.headers.get("content-length") || 0);
  if (declaredLength > MAX_BODY_BYTES) throw new Error("PAYLOAD_TOO_LARGE");
  const body = await request.text();
  if (new TextEncoder().encode(body).byteLength > MAX_BODY_BYTES) throw new Error("PAYLOAD_TOO_LARGE");

  let parsed;
  try { parsed = JSON.parse(body); } catch { throw new Error("INVALID_JSON"); }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("INVALID_BUILD");
  return { body, parsed };
}

async function enforceRateLimit(env, key, limit, now) {
  const minute = Math.floor(now / 60);
  const bucket = `${key}:${minute}`;
  const row = await env.DB.prepare(
    "INSERT INTO rate_limits (bucket, request_count) VALUES (?, 1) " +
    "ON CONFLICT(bucket) DO UPDATE SET request_count = request_count + 1 " +
    "RETURNING request_count"
  ).bind(bucket).first();

  // Keep only the current and immediately previous minute of rate-limit buckets.
  await env.DB.prepare("DELETE FROM rate_limits WHERE bucket NOT LIKE ? AND bucket NOT LIKE ?")
    .bind(`%:${minute}`, `%:${minute - 1}`).run();

  return Number(row?.request_count || 0) <= limit;
}

async function authorize(request, env) {
  if (!env.DB) return { response: json({ error: "Database is not configured." }, 500) };

  const userId = request.headers.get("x-roblox-userid") || "";
  const timestampText = request.headers.get("x-request-timestamp") || "";
  const nonce = request.headers.get("x-request-nonce") || "";
  if (!/^\d{1,20}$/.test(userId) || Number(userId) < 1) {
    return { response: json({ error: "A valid Roblox UserId is required." }, 401) };
  }
  if (!/^\d{10}$/.test(timestampText) || !/^[0-9a-fA-F-]{36}$/.test(nonce)) {
    return { response: json({ error: "Request timestamp or nonce is missing." }, 401) };
  }

  const now = Math.floor(Date.now() / 1000);
  const timestamp = Number(timestampText);
  if (!Number.isSafeInteger(timestamp) || Math.abs(now - timestamp) > TIMESTAMP_TOLERANCE_SECONDS) {
    return { response: json({ error: "Request timestamp is expired or invalid." }, 401) };
  }

  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const ipHashBytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(ip));
  const ipHash = [...new Uint8Array(ipHashBytes)].map(x => x.toString(16).padStart(2, "0")).join("");
  try {
    const [userAllowed, ipAllowed] = await Promise.all([
      enforceRateLimit(env, `user:${userId}`, USER_REQUESTS_PER_MINUTE, now),
      enforceRateLimit(env, `ip:${ipHash}`, IP_REQUESTS_PER_MINUTE, now)
    ]);
    if (!userAllowed || !ipAllowed) {
      return { response: json({ error: "Too many requests. Please wait a minute." }, 429) };
    }

    // Remove expired one-time nonces so this table cannot grow indefinitely.
    await env.DB.prepare("DELETE FROM request_nonces WHERE expires_at <= ?").bind(now).run();
    const nonceResult = await env.DB.prepare(
      "INSERT OR IGNORE INTO request_nonces (nonce, expires_at) VALUES (?, ?)"
    ).bind(nonce, now + TIMESTAMP_TOLERANCE_SECONDS * 2).run();
    if (nonceResult.meta?.changes !== 1) {
      return { response: json({ error: "This request has already been used." }, 409) };
    }

    const cached = await env.DB.prepare(
      "SELECT is_member, checked_at FROM membership_cache WHERE user_id = ?"
    ).bind(userId).first();

    let isMember;
    if (cached && now - Number(cached.checked_at) < MEMBERSHIP_CACHE_SECONDS) {
      isMember = Number(cached.is_member) === 1;
    } else {
      let groupResponse;
      try {
        groupResponse = await fetch(
          `https://groups.roblox.com/v2/users/${userId}/groups/roles`,
          { headers: { "accept": "application/json" }, signal: AbortSignal.timeout(5000) }
        );
      } catch {
        return { response: json({ error: "Roblox membership verification is temporarily unavailable." }, 503) };
      }
      if (!groupResponse.ok) {
        return { response: json({ error: "Roblox membership verification is temporarily unavailable." }, 503) };
      }
      const groupData = await groupResponse.json();
      isMember = Array.isArray(groupData.data) && groupData.data.some(
        item => Number(item.group?.id) === REQUIRED_GROUP_ID
      );
      await env.DB.prepare(
        "INSERT INTO membership_cache (user_id, is_member, checked_at) VALUES (?, ?, ?) " +
        "ON CONFLICT(user_id) DO UPDATE SET is_member = excluded.is_member, checked_at = excluded.checked_at"
      ).bind(userId, isMember ? 1 : 0, now).run();
    }

    if (!isMember) return { response: json({ error: "You must be a member of the required Roblox group." }, 403) };
    return { userId };
  } catch {
    return { response: json({ error: "Security check temporarily failed. Please try again." }, 503) };
  }
}

async function enforceExportCooldown(env, userId) {
  const now = Date.now();
  const row = await env.DB.prepare(
    "INSERT INTO export_guard (user_id, last_attempt_ms, rapid_count, blocked_until_ms) VALUES (?, ?, 0, 0) " +
    "ON CONFLICT(user_id) DO UPDATE SET " +
    "rapid_count = CASE WHEN excluded.last_attempt_ms - export_guard.last_attempt_ms < 5000 THEN export_guard.rapid_count + 1 ELSE 0 END, " +
    "blocked_until_ms = CASE WHEN export_guard.blocked_until_ms > excluded.last_attempt_ms THEN export_guard.blocked_until_ms " +
    "WHEN excluded.last_attempt_ms - export_guard.last_attempt_ms < 5000 AND export_guard.rapid_count >= 2 THEN excluded.last_attempt_ms + 20000 ELSE 0 END, " +
    "cooldown_until_ms = CASE WHEN excluded.last_attempt_ms - export_guard.last_attempt_ms < 1000 THEN export_guard.last_attempt_ms + 1000 ELSE 0 END, " +
    "last_attempt_ms = excluded.last_attempt_ms " +
    "RETURNING rapid_count, blocked_until_ms, cooldown_until_ms"
  ).bind(userId, now).first();

  if (Number(row?.blocked_until_ms || 0) > now) {
    return { blocked: true, retryAfter: Math.ceil((Number(row.blocked_until_ms) - now) / 1000) };
  }
  if (Number(row?.cooldown_until_ms || 0) > now) {
    return { blocked: false, cooldown: true, retryAfter: Math.ceil((Number(row.cooldown_until_ms) - now) / 1000) };
  }
  return { blocked: false, cooldown: false };
}

async function saveBuild(request, env) {
  const auth = await authorize(request, env);
  if (auth.response) return auth.response;

  const cooldown = await enforceExportCooldown(env, auth.userId);
  if (cooldown.blocked) {
    return json({ error: "Export paused because of repeated rapid requests. Please wait.", retryAfter: cooldown.retryAfter }, 429);
  }
  if (cooldown.cooldown) {
    return json({ error: "Please wait one second before exporting again.", retryAfter: cooldown.retryAfter }, 429);
  }

  let body;
  try {
    ({ body } = await readRequestJson(request));
  } catch (error) {
    if (error.message === "PAYLOAD_TOO_LARGE") return json({ error: "Build is too large. Maximum size is 512 KiB." }, 413);
    if (error.message === "INVALID_JSON") return json({ error: "Request body must be valid JSON." }, 400);
    return json({ error: "Build must be a JSON object." }, 400);
  }

  const now = Math.floor(Date.now() / 1000);
  for (let attempt = 0; attempt < 100; attempt++) {
    const code = makeCode();
    if (!code) continue;
    const result = await env.DB.prepare(
      "INSERT OR IGNORE INTO builds (code, payload, created_at, expires_at, last_accessed) VALUES (?, ?, ?, ?, ?)"
    ).bind(code, body, now, NEVER_EXPIRES, now).run();
    if (result.meta?.changes === 1) {
      return json({ success: true, code, createdAt: now, expiresAt: null }, 201);
    }
  }

  // Only recycle an old build when every usable short code is occupied.
  const count = await env.DB.prepare("SELECT COUNT(*) AS total FROM builds").first();
  if (Number(count?.total || 0) >= CODE_CAPACITY - BLOCKED_CODE_FRAGMENTS.length) {
    const oldest = await env.DB.prepare(
      "SELECT code FROM builds ORDER BY last_accessed ASC, created_at ASC LIMIT 1"
    ).first();
    if (oldest?.code) {
      await env.DB.prepare("DELETE FROM builds WHERE code = ?").bind(oldest.code).run();
      const result = await env.DB.prepare(
        "INSERT OR IGNORE INTO builds (code, payload, created_at, expires_at, last_accessed) VALUES (?, ?, ?, ?, ?)"
      ).bind(oldest.code, body, now, NEVER_EXPIRES, now).run();
      if (result.meta?.changes === 1) {
        return json({ success: true, code: oldest.code, createdAt: now, expiresAt: null, recycled: true }, 201);
      }
    }
  }
  return json({ error: "Could not allocate a build code. Please try again." }, 503);
}

async function getBuild(code, request, env) {
  const auth = await authorize(request, env);
  if (auth.response) return auth.response;
  if (!/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}$/.test(code)) {
    return json({ error: "Build code was not found." }, 404);
  }
  const row = await env.DB.prepare(
    "SELECT payload FROM builds WHERE code = ?"
  ).bind(code).first();
  if (!row) return json({ error: "Build code was not found." }, 404);
  await env.DB.prepare("UPDATE builds SET last_accessed = ? WHERE code = ?")
    .bind(Math.floor(Date.now() / 1000), code).run();
  return new Response(row.payload, {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...corsHeaders()
    }
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders() });
    if (request.method === "GET" && url.pathname === "/") {
      return json({
        service: "Independent F3X Import / Export API",
        status: "online",
        requiredGroupId: REQUIRED_GROUP_ID,
        endpoints: ["POST /api/builds", "GET /api/builds/:code"]
      });
    }
    if (request.method === "POST" && url.pathname === "/api/builds") return saveBuild(request, env);
    const match = url.pathname.match(/^\/api\/builds\/([^/]+)$/);
    if (request.method === "GET" && match) return getBuild(match[1].toUpperCase(), request, env);
    return json({ error: "Route not found." }, 404);
  }
};
