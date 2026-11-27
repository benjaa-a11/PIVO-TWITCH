const TWITCH_GQL_ENDPOINT = "https://gql.twitch.tv/gql";
const TWITCH_USHER_ENDPOINT = "https://usher.ttvnw.net";
const TWITCH_CLIENT_ID = "kimne78kx3ncx6brgo4mv6wki5h1ko";
const PLAYBACK_ACCESS_TOKEN_HASH = "ed230aa1e33e07eebb8928504583da78a5173989fadfb1ac94be06a04f3cdbe9";
const APP_VERSION = "1.0.0";

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store, max-age=0",
  "x-content-type-options": "nosniff",
};

const CHANNEL_NAME_PATTERN = /^[a-z0-9_]{1,25}$/i;
const ALLOWED_TWITCH_HOSTS = new Set(["twitch.tv", "www.twitch.tv", "m.twitch.tv", "player.twitch.tv"]);
const RESERVED_TWITCH_PATHS = new Set([
  "directory", "downloads", "jobs", "p", "popout", "settings",
  "subscriptions", "videos", "wallet", "search", "inventory",
  "friends", "following", "turbo", "drops", "moderator",
]);

export function extractChannel(input) {
  if (typeof input !== "string" || !input.trim()) {
    throw new ResolverError("MISSING_CHANNEL", "Ingresá un enlace o nombre de canal de Twitch.", 400);
  }
  const value = input.trim();
  let channel = value;
  if (/^https?:\/\//i.test(value)) {
    let parsed;
    try { parsed = new URL(value); }
    catch { throw new ResolverError("INVALID_URL", "El enlace ingresado no es válido.", 400); }
    const host = parsed.hostname.toLowerCase();
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      throw new ResolverError("INVALID_URL", "Solo se admiten enlaces HTTP o HTTPS de Twitch.", 400);
    }
    if (!ALLOWED_TWITCH_HOSTS.has(host)) {
      throw new ResolverError("UNSUPPORTED_DOMAIN", "Por seguridad, solo se aceptan enlaces del dominio twitch.tv.", 400);
    }
    const segments = parsed.pathname.split("/").filter(Boolean);
    if (!segments.length) throw new ResolverError("INVALID_CHANNEL_URL", "El enlace no contiene un canal de Twitch.", 400);
    channel = segments[0].replace(/\.m3u8$/i, "");
    if (RESERVED_TWITCH_PATHS.has(channel.toLowerCase())) {
      throw new ResolverError("UNSUPPORTED_TWITCH_URL", "Ingresá el enlace directo de un canal en vivo, no una sección, video o página de Twitch.", 400);
    }
  } else if (value.includes("://") || value.includes("/")) {
    throw new ResolverError("INVALID_CHANNEL", "Ingresá solamente el nombre del canal o su enlace de Twitch.", 400);
  }
  channel = channel.replace(/^@/, "").toLowerCase();
  if (!CHANNEL_NAME_PATTERN.test(channel)) {
    throw new ResolverError("INVALID_CHANNEL", "El nombre del canal no tiene un formato válido de Twitch.", 400);
  }
  return channel;
}

export function parseMasterPlaylist(playlistText, baseUrl) {
  const lines = String(playlistText || "").replace(/^\uFEFF/, "").split(/\r?\n/);
  const variants = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line.startsWith("#EXT-X-STREAM-INF:")) continue;
    const attributes = parseHlsAttributes(line.slice("#EXT-X-STREAM-INF:".length));
    let uri = "";
    for (let next = index + 1; next < lines.length; next += 1) {
      const candidate = lines[next].trim();
      if (!candidate || candidate.startsWith("#")) continue;
      uri = candidate; index = next; break;
    }
    if (!uri) continue;
    let absoluteUrl;
    try { absoluteUrl = new URL(uri, baseUrl).toString(); } catch { continue; }
    if (!/^https:\/\//i.test(absoluteUrl)) continue;
    const resolution = attributes.RESOLUTION || "";
    const height = resolution.includes("x") ? resolution.split("x").at(-1) : "";
    const name = (attributes.NAME || "").replace(/\s+/g, " ").trim();
    variants.push({
      label: name || (height ? `${height}p` : "Calidad disponible"),
      resolution: resolution || null,
      frameRate: attributes["FRAME-RATE"] ? Number(attributes["FRAME-RATE"]) : null,
      bandwidth: attributes.BANDWIDTH ? Number(attributes.BANDWIDTH) : null,
      url: absoluteUrl,
    });
  }
  return variants.sort((a, b) => {
    const ah = Number((a.resolution || "0x0").split("x").at(-1)) || 0;
    const bh = Number((b.resolution || "0x0").split("x").at(-1)) || 0;
    return bh - ah;
  });
}

function parseHlsAttributes(source) {
  const attributes = {};
  const pattern = /([A-Z0-9-]+)=(?:"([^"]*)"|([^,]*))/g;
  let match;
  while ((match = pattern.exec(source)) !== null) attributes[match[1]] = match[2] ?? match[3] ?? "";
  return attributes;
}

class ResolverError extends Error {
  constructor(code, message, status = 502) {
    super(message); this.name = "ResolverError"; this.code = code; this.status = status;
  }
}

async function fetchWithTimeout(url, options, timeoutMs = 12000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try { return await fetch(url, { ...options, signal: controller.signal, redirect: "follow" }); }
  catch (error) {
    if (error?.name === "AbortError") throw new ResolverError("UPSTREAM_TIMEOUT", "Twitch tardó demasiado en responder. Probá nuevamente en unos segundos.", 504);
    throw new ResolverError("UPSTREAM_UNAVAILABLE", "No se pudo conectar con Twitch. Revisá el servicio e intentá nuevamente.", 502);
  } finally { clearTimeout(timeout); }
}

async function getPlaybackToken(channel) {
  const payload = {
    operationName: "PlaybackAccessToken",
    extensions: { persistedQuery: { version: 1, sha256Hash: PLAYBACK_ACCESS_TOKEN_HASH } },
    variables: { isLive: true, login: channel, isVod: false, vodID: "", playerType: "embed", platform: "site" },
  };
  const response = await fetchWithTimeout(TWITCH_GQL_ENDPOINT, {
    method: "POST",
    headers: {
      "Client-ID": TWITCH_CLIENT_ID, "Content-Type": "application/json", "Accept": "application/json",
      "Origin": "https://www.twitch.tv", "Referer": `https://www.twitch.tv/${channel}`,
      "User-Agent": "Mozilla/5.0 (compatible; PIVO-TWITCH/1.0; +https://github.com/benjaa-a11/PIVO-TWITCH)",
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new ResolverError("TWITCH_TOKEN_REJECTED", `Twitch rechazó la solicitud del token (HTTP ${response.status}). Puede ser un cambio temporal de su API o una restricción del canal.`, 502);
  let data;
  try { data = await response.json(); }
  catch { throw new ResolverError("INVALID_TWITCH_RESPONSE", "Twitch devolvió una respuesta que no se pudo interpretar.", 502); }
  if (Array.isArray(data?.errors) && data.errors.length) {
    const message = data.errors.map((item) => item?.message).filter(Boolean).join("; ");
    throw new ResolverError("TWITCH_GQL_ERROR", message || "Twitch no autorizó la solicitud de reproducción.", 502);
  }
  const token = data?.data?.streamPlaybackAccessToken;
  if (!token?.value || !token?.signature) throw new ResolverError("STREAM_OFFLINE", `El canal ${channel} no está transmitiendo en vivo o Twitch no permite obtener su reproducción.`, 404);
  return token;
}

async function getMasterPlaylist(channel, token) {
  const playlistUrl = new URL(`${TWITCH_USHER_ENDPOINT}/api/channel/hls/${encodeURIComponent(channel)}.m3u8`);
  const params = playlistUrl.searchParams;
  params.set("sig", token.signature); params.set("token", token.value); params.set("platform", "web");
  params.set("p", String(Math.floor(Math.random() * 999999) + 1));
  params.set("allow_source", "true"); params.set("allow_audio_only", "true");
  params.set("playlist_include_framerate", "true"); params.set("multigroup_video", "true");
  params.set("supported_codecs", "av1,h265,h264");
  const response = await fetchWithTimeout(playlistUrl.toString(), {
    method: "GET",
    headers: {
      "Accept": "application/vnd.apple.mpegurl, application/x-mpegURL, */*",
      "Origin": "https://www.twitch.tv", "Referer": `https://www.twitch.tv/${channel}`,
      "User-Agent": "Mozilla/5.0 (compatible; PIVO-TWITCH/1.0)",
    },
  });
  if (!response.ok) throw new ResolverError("TWITCH_PLAYLIST_REJECTED", `Twitch no entregó la playlist (HTTP ${response.status}). El canal puede estar offline o sujeto a restricciones.`, 502);
  const content = await response.text();
  if (!content.trimStart().startsWith("#EXTM3U")) throw new ResolverError("INVALID_PLAYLIST", "Twitch no devolvió una playlist HLS válida.", 502);
  return { url: playlistUrl.toString(), content };
}

export async function resolveLiveStream(input) {
  const channel = extractChannel(input);
  const token = await getPlaybackToken(channel);
  const playlist = await getMasterPlaylist(channel, token);
  const variants = parseMasterPlaylist(playlist.content, playlist.url);
  return {
    success: true, provider: "Twitch", channel, resolvedAt: new Date().toISOString(),
    expires: "Temporal; Twitch puede renovar o invalidar esta URL.",
    masterPlaylistUrl: playlist.url, variants, variantCount: variants.length,
    masterPlaylist: playlist.content,
  };
}

function getCorsHeaders(request, env) {
  const origin = request.headers.get("Origin");
  const configured = typeof env.ALLOWED_ORIGINS === "string" && env.ALLOWED_ORIGINS.trim()
    ? env.ALLOWED_ORIGINS.split(",").map((item) => item.trim()).filter(Boolean) : null;
  const allowedOrigin = !configured || configured.includes("*") ? "*" : (origin && configured.includes(origin) ? origin : "null");
  return {
    "access-control-allow-origin": allowedOrigin, "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "Content-Type", "access-control-max-age": "86400", vary: "Origin",
  };
}

function jsonResponse(request, env, payload, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { ...JSON_HEADERS, ...getCorsHeaders(request, env) } });
}
function getInputFromRequest(url, body = null) {
  return body?.url || body?.id || body?.channel || url.searchParams.get("id") || url.searchParams.get("url") || url.searchParams.get("channel") || "";
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    if ((path.startsWith("/api/") || path.startsWith("/live/")) && request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: getCorsHeaders(request, env) });
    }
    if (path === "/api/health" && request.method === "GET") {
      return jsonResponse(request, env, { ok: true, service: "PIVO-TWITCH", version: APP_VERSION });
    }
    // Root URL with ?id=... is the player-friendly entry point.
    // Resolve a fresh Twitch master playlist and redirect to its signed .m3u8 URL.
    if (path === "/" && request.method === "GET" && (url.searchParams.has("id") || url.searchParams.has("url") || url.searchParams.has("channel"))) {
      try {
        const result = await resolveLiveStream(getInputFromRequest(url));
        return new Response(null, {
          status: 302,
          headers: {
            Location: result.masterPlaylistUrl,
            "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
            "Pragma": "no-cache",
            "Access-Control-Allow-Origin": getCorsHeaders(request, env)["access-control-allow-origin"],
            "X-Content-Type-Options": "nosniff",
          },
        });
      } catch (error) {
        const known = error instanceof ResolverError;
        return jsonResponse(request, env, {
          success: false,
          error: {
            code: known ? error.code : "INTERNAL_ERROR",
            message: known ? error.message : "No se pudo resolver el canal.",
          },
        }, known ? error.status : 500);
      }
    }
    if (path === "/api/resolve" && (request.method === "GET" || request.method === "POST")) {
      let body = null;
      if (request.method === "POST") {
        try { body = await request.json(); }
        catch { return jsonResponse(request, env, { success: false, error: { code: "INVALID_JSON", message: "El cuerpo de la solicitud no contiene JSON válido." } }, 400); }
      }
      try {
        const result = await resolveLiveStream(getInputFromRequest(url, body));
        if (url.searchParams.get("format") === "m3u8") {
          return new Response(result.masterPlaylist, {
            status: 200, headers: {
              "content-type": "application/vnd.apple.mpegurl; charset=utf-8", "cache-control": "no-store, max-age=0",
              "access-control-allow-origin": getCorsHeaders(request, env)["access-control-allow-origin"], "x-content-type-options": "nosniff",
            },
          });
        }
        return jsonResponse(request, env, result);
      } catch (error) {
        const known = error instanceof ResolverError;
        return jsonResponse(request, env, { success: false, error: {
          code: known ? error.code : "INTERNAL_ERROR",
          message: known ? error.message : "Ocurrió un error inesperado al resolver el stream.",
        } }, known ? error.status : 500);
      }
    }
    const liveMatch = path.match(/^\/live\/([a-z0-9_]{1,25})\.m3u8$/i);
    if (liveMatch && request.method === "GET") {
      try {
        const result = await resolveLiveStream(liveMatch[1]);
        return new Response(null, { status: 302, headers: {
          Location: result.masterPlaylistUrl, "Cache-Control": "no-store, max-age=0",
          "Access-Control-Allow-Origin": getCorsHeaders(request, env)["access-control-allow-origin"],
        } });
      } catch (error) {
        const known = error instanceof ResolverError;
        return jsonResponse(request, env, { success: false, error: {
          code: known ? error.code : "INTERNAL_ERROR", message: known ? error.message : "No se pudo resolver el canal.",
        } }, known ? error.status : 500);
      }
    }
    if (request.method === "GET" || request.method === "HEAD") {
      if (!env.ASSETS) return new Response("Static assets binding ASSETS is not configured.", { status: 500 });
      return env.ASSETS.fetch(request);
    }
    return new Response("Method Not Allowed", { status: 405, headers: { Allow: "GET, HEAD, OPTIONS, POST" } });
  },
};
