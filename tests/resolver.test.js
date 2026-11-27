import test from "node:test";
import assert from "node:assert/strict";
import worker, { extractChannel, parseMasterPlaylist } from "../src/index.js";

const masterPlaylist = [
  "#EXTM3U",
  "#EXT-X-VERSION:3",
  '#EXT-X-STREAM-INF:BANDWIDTH=6000000,RESOLUTION=1920x1080,NAME="1080p60"',
  "chunked/index.m3u8",
  '#EXT-X-STREAM-INF:BANDWIDTH=2800000,RESOLUTION=1280x720,NAME="720p60"',
  "https://video.example/720.m3u8",
].join("\n");

const originalFetch = globalThis.fetch;

test("extracts a channel from Twitch mobile, desktop and username inputs", () => {
  assert.equal(extractChannel("https://m.twitch.tv/luzu_tv"), "luzu_tv");
  assert.equal(extractChannel("https://www.twitch.tv/Luzu_TV"), "luzu_tv");
  assert.equal(extractChannel("luzu_tv"), "luzu_tv");
  assert.equal(extractChannel("@LUZU_TV"), "luzu_tv");
});

test("rejects non-Twitch domains, reserved paths and malformed names", () => {
  assert.throws(() => extractChannel("https://example.com/luzu_tv"), /solo se aceptan enlaces/);
  assert.throws(() => extractChannel("https://anything.twitch.tv/luzu_tv"), /solo se aceptan enlaces/);
  assert.throws(() => extractChannel("https://twitch.tv/videos/123"), /enlace directo de un canal/);
  assert.throws(() => extractChannel("a channel with spaces"), /formato válido/);
});

test("parses and sorts HLS variants, resolving relative URLs", () => {
  const variants = parseMasterPlaylist(masterPlaylist, "https://usher.ttvnw.net/base/master.m3u8");
  assert.equal(variants.length, 2);
  assert.equal(variants[0].label, "1080p60");
  assert.equal(variants[0].resolution, "1920x1080");
  assert.equal(variants[0].url, "https://usher.ttvnw.net/base/chunked/index.m3u8");
  assert.equal(variants[1].label, "720p60");
});

test("API returns a fresh master URL and variants", async () => {
  let calls = 0;
  globalThis.fetch = async (input, init = {}) => {
    calls += 1;
    if (String(input).includes("gql.twitch.tv")) {
      assert.equal(init.method, "POST");
      assert.match(init.headers["Client-ID"], /^[a-z0-9]+$/);
      return new Response(JSON.stringify({
        data: { streamPlaybackAccessToken: { value: "test-token", signature: "test-signature" } },
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    assert.match(String(input), /^https:\/\/usher\.ttvnw\.net\/api\/channel\/hls\/luzu_tv\.m3u8/);
    return new Response(masterPlaylist, { status: 200 });
  };

  try {
    const response = await worker.fetch(new Request("https://pivo.test/api/resolve?id=https%3A%2F%2Fm.twitch.tv%2Fluzu_tv"), {});
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.success, true);
    assert.equal(body.channel, "luzu_tv");
    assert.equal(body.variantCount, 2);
    assert.match(body.masterPlaylistUrl, /^https:\/\/usher\.ttvnw\.net\//);
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("API reports an offline channel with a useful 404", async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({
    data: { streamPlaybackAccessToken: null },
  }), { status: 200, headers: { "content-type": "application/json" } });

  try {
    const response = await worker.fetch(new Request("https://pivo.test/api/resolve?channel=luzu_tv"), {});
    const body = await response.json();
    assert.equal(response.status, 404);
    assert.equal(body.error.code, "STREAM_OFFLINE");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
