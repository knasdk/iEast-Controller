const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

function loadEnvFile(filePath) {
  let contents;
  try {
    contents = fs.readFileSync(filePath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  for (const line of contents.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match || process.env[match[1]] !== undefined) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[match[1]] = value;
  }
}

loadEnvFile(path.join(__dirname, ".env"));

const HOST = process.env.HOST || "0.0.0.0";
const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(__dirname, "public");
const STATE_DIR = path.resolve(process.env.STATE_DIR || path.join(__dirname, ".state"));
const SETTINGS_FILE = path.join(STATE_DIR, "settings.json");
const SPOTIFY_FILE = path.join(STATE_DIR, "spotify.json");
const PLAYBACK_FILE = path.join(STATE_DIR, "playback.json");
const SPOTIFY_REDIRECT_URI = process.env.SPOTIFY_REDIRECT_URI || "";
const artworkCache = new Map();
let directPlayback = null;
let spotifyAuthorization = null;
let streamerName = "";
let spotifyPlaybackCache = { expiresAt: 0, value: null };

const defaultRadios = [
  { id: "radio-nova", name: "Nova FM", url: "http://live-bauerdk.sharp-stream.com/nova_dk_mp3", artwork: "https://www.radio.dk/300/novafm.png" },
  { id: "radio-myrock", name: "MyRock", url: "http://live-bauerdk.sharp-stream.com/myrock_dk_mp3", artwork: "https://www.radio.dk/300/myrock.png" },
  { id: "radio-popfm", name: "Pop FM", url: "http://live-bauerdk.sharp-stream.com/popfm_dk_mp3", artwork: "https://www.radio.dk/300/popfmdk.png" },
  { id: "radio-humleborg-jazz", name: "Radio Humleborg Jazzkanalen", url: "http://ca6.rcast.net:4058/;stream.mp3", artwork: "https://www.radio.dk/300/humleborgjazz.png" },
  { id: "radio-retro", name: "Retro Radio", url: "http://streammp3.retro-radio.dk/retro-mp3?type=.mp3", artwork: "https://www.radio.dk/300/retroradiodk.jpeg" },
  { id: "radio-p8-jazz", name: "DR P8 Jazz", url: "http://live-icy.gslb01.dr.dk/A/A22H.mp3", artwork: "https://www.radio.dk/300/drp8jazz.png" },
  { id: "radio-klassisk", name: "Radio Klassisk", url: "http://live-bauerdk.sharp-stream.com/radio100_dk_mp3?radioklassisk", artwork: "https://www.radio.dk/300/radioklassisk.png" },
  { id: "radio-ndr2", name: "NDR 2", url: "http://icecast.ndr.de/ndr/ndr2/niedersachsen/mp3/128/stream.mp3?aggregator=radio-de", artwork: "https://www.radio.dk/300/ndr2.png" },
  { id: "radio-fip", name: "FIP", url: "http://icecast.radiofrance.fr/fip-hifi.aac", artwork: "https://www.radio.dk/300/fip.jpeg" },
  { id: "radio-jazz-lounge", name: "Jazz Radio - Lounge", url: "http://jazzlounge.ice.infomaniak.ch/jazzlounge-high.mp3", artwork: "https://www.radio.dk/300/jazzradio-lounge.jpeg" },
  { id: "radio-groove-salad", name: "SomaFM - Groove Salad Classic", url: "http://ice4.somafm.com/gsclassic-64-aac", artwork: "https://www.radio.dk/300/somafm-groovesalad.png" },
  { id: "radio-classic-fm", name: "Classic FM", url: "http://media-ssl.musicradio.com/ClassicFM", artwork: "https://www.radio.dk/300/classicfm.png" },
  { id: "radio-jazz24", name: "Jazz24", url: "http://knkx-live-a.edge.audiocdn.com/6285_128k?aw_0_1st.playerid=radio.net", artwork: "https://www.radio.dk/300/jazz24.png" },
  { id: "radio-paradise", name: "Radio Paradise", url: "http://stream.radioparadise.com/aac-128", artwork: "https://www.radio.dk/300/radioparadise.png" },
  { id: "radio-oldie-antenne", name: "80er 90er OLDIE ANTENNE", url: "http://stream.oldie-antenne.de/oldie-antenne/stream/mp3?aw_0_1st.playerid=radio.de", artwork: "https://www.radio.dk/300/oldieantenne.jpeg" },
];

function mediaServersFromEnv() {
  if (process.env.MEDIA_SERVERS) {
    const servers = JSON.parse(process.env.MEDIA_SERVERS);
    if (!Array.isArray(servers)) throw new Error("MEDIA_SERVERS skal være et JSON-array");
    return servers.map((server, index) => ({
      id: String(server.id || `server-${index + 1}`),
      name: String(server.name || `Medieserver ${index + 1}`),
      url: String(server.url || ""),
    }));
  }
  return process.env.MEDIA_SERVER_URL
    ? [{ id: "primary", name: process.env.MEDIA_SERVER_NAME || "Medieserver", url: process.env.MEDIA_SERVER_URL }]
    : [];
}

const defaultConfig = {
  deviceIp: process.env.IEAST_IP || "192.168.1.100",
  mediaServers: mediaServersFromEnv(),
  radios: defaultRadios,
  spotifyClientId: process.env.SPOTIFY_CLIENT_ID || "",
};

if (STATE_DIR) {
  fs.mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 });
  fs.chmodSync(STATE_DIR, 0o700);
}
let settings = {};
if (SETTINGS_FILE) {
  try {
    settings = JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf8"));
  } catch {
    // Persistent radio settings have not been saved yet.
  }
}
let config = { ...defaultConfig, radios: Array.isArray(settings.radios) ? settings.radios : defaultRadios };
let spotifyTokens = null;
if (SPOTIFY_FILE) {
  try {
    spotifyTokens = JSON.parse(fs.readFileSync(SPOTIFY_FILE, "utf8"));
  } catch {
    // Spotify has not been connected yet.
  }
}
if (PLAYBACK_FILE) {
  try {
    directPlayback = JSON.parse(fs.readFileSync(PLAYBACK_FILE, "utf8"));
  } catch {
    // Playback metadata is created after the first local stream starts.
  }
}

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
};

const playerCommands = new Set(["play", "pause", "stop", "next", "prev"]);

function sendJson(response, status, payload) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  response.end(JSON.stringify(payload));
}

function redirect(response, location) {
  response.writeHead(302, { Location: location, "Cache-Control": "no-store" });
  response.end();
}

function getSpotifyRedirectUri(request) {
  if (SPOTIFY_REDIRECT_URI) return SPOTIFY_REDIRECT_URI;
  const forwardedProto = request.headers["x-forwarded-proto"]?.split(",")[0].trim();
  const forwardedHost = request.headers["x-forwarded-host"]?.split(",")[0].trim();
  const protocol = forwardedProto || (request.socket.encrypted ? "https" : "http");
  const host = forwardedHost || request.headers.host || `127.0.0.1:${PORT}`;
  const origin = new URL(`${protocol}://${host}`);
  if (origin.hostname === "localhost") origin.hostname = "127.0.0.1";
  return new URL("/api/spotify/callback", origin).href;
}

function saveSpotifyTokens(tokens) {
  spotifyTokens = tokens;
  if (!SPOTIFY_FILE) return;
  fs.writeFileSync(SPOTIFY_FILE, `${JSON.stringify(tokens, null, 2)}\n`, { mode: 0o600 });
  fs.chmodSync(SPOTIFY_FILE, 0o600);
}

function saveDirectPlayback(playback) {
  directPlayback = playback;
  if (!PLAYBACK_FILE) return;
  if (!playback) {
    try {
      fs.unlinkSync(PLAYBACK_FILE);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    return;
  }
  fs.writeFileSync(PLAYBACK_FILE, `${JSON.stringify(playback, null, 2)}\n`, { mode: 0o600 });
  fs.chmodSync(PLAYBACK_FILE, 0o600);
}

function clearSpotifyTokens() {
  spotifyTokens = null;
  if (!SPOTIFY_FILE) return;
  try {
    fs.unlinkSync(SPOTIFY_FILE);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

function isIpAddress(value) {
  const parts = String(value).split(".");
  return parts.length === 4 && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255);
}

function normalizeMediaUrl(value) {
  const input = String(value || "").trim();
  const withProtocol = /^https?:\/\//i.test(input) ? input : `http://${input}${input.includes(":") ? "" : ":8200"}`;
  const url = new URL(withProtocol);
  if (!new Set(["http:", "https:"]).has(url.protocol)) throw new Error("Ugyldig medieserver-adresse");
  return url.href.replace(/\/$/, "");
}

function normalizeConfig(input) {
  if (!isIpAddress(input.deviceIp)) throw new Error("Indtast en gyldig iEast IP-adresse");
  if (!Array.isArray(input.mediaServers) || !Array.isArray(input.radios)) throw new Error("Ugyldig konfiguration");
  if (input.mediaServers.length > 20 || input.radios.length > 100) throw new Error("For mange poster");
  return {
    deviceIp: input.deviceIp,
    spotifyClientId: String(input.spotifyClientId || "").trim().slice(0, 100),
    mediaServers: input.mediaServers.map((server) => {
      const name = String(server.name || "").trim().slice(0, 80);
      if (!name) throw new Error("Alle medieservere skal have et navn");
      return { id: String(server.id || crypto.randomUUID()), name, url: normalizeMediaUrl(server.url) };
    }),
    radios: input.radios.map((radio) => {
      const name = String(radio.name || "").trim().slice(0, 100);
      let url;
      try {
        url = new URL(radio.url);
        if (!new Set(["http:", "https:"]).has(url.protocol)) throw new Error();
      } catch {
        throw new Error(`Ugyldigt radiolink${name ? ` for ${name}` : ""}`);
      }
      if (!name) throw new Error("Alle radiolinks skal have et navn");
      let artwork = null;
      if (radio.artwork) {
        const artworkUrl = new URL(radio.artwork);
        if (!new Set(["http:", "https:"]).has(artworkUrl.protocol)) throw new Error(`Ugyldigt radiologo for ${name}`);
        artwork = artworkUrl.href;
      }
      const rating = Number.isInteger(radio.rating) ? Math.min(5, Math.max(0, radio.rating)) : 0;
      return { id: String(radio.id || crypto.randomUUID()), name, url: url.href, artwork, rating };
    }),
  };
}

function saveConfig(nextConfig) {
  const normalized = normalizeConfig({ ...config, radios: nextConfig.radios });
  config = { ...config, radios: normalized.radios };
  if (SETTINGS_FILE) {
    fs.writeFileSync(SETTINGS_FILE, `${JSON.stringify({ radios: config.radios }, null, 2)}\n`, { mode: 0o600 });
    fs.chmodSync(SETTINGS_FILE, 0o600);
  }
  return config;
}

function publicConfig() {
  const { spotifyClientId, ...publicValues } = config;
  return { ...publicValues, spotifyConfigured: Boolean(spotifyClientId) };
}

function base64Url(buffer) {
  return buffer.toString("base64").replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

async function exchangeSpotifyToken(parameters) {
  const response = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(parameters),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error_description || data.error || "Spotify-login mislykkedes");
  return data;
}

async function getSpotifyToken() {
  if (!spotifyTokens?.refresh_token && !spotifyTokens?.access_token) throw new Error("Spotify er ikke forbundet");
  if (spotifyTokens.access_token && spotifyTokens.expires_at > Date.now() + 30_000) return spotifyTokens.access_token;
  const refreshed = await exchangeSpotifyToken({
    grant_type: "refresh_token",
    refresh_token: spotifyTokens.refresh_token,
    client_id: config.spotifyClientId,
  });
  saveSpotifyTokens({
    ...spotifyTokens,
    ...refreshed,
    refresh_token: refreshed.refresh_token || spotifyTokens.refresh_token,
    expires_at: Date.now() + refreshed.expires_in * 1000,
  });
  return spotifyTokens.access_token;
}

async function spotifyFetch(pathname, options = {}) {
  const token = await getSpotifyToken();
  const response = await fetch(`https://api.spotify.com/v1${pathname}`, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, ...options.headers },
  });
  if (response.status === 204) return null;
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error?.message || `Spotify svarede med HTTP ${response.status}`);
  return data;
}

function spotifySearchResults(data) {
  const image = (images) => images?.[0]?.url || null;
  return [
    ...(data.tracks?.items || []).map((item) => ({
      type: "track", uri: item.uri, title: item.name, subtitle: item.artists.map((artist) => artist.name).join(", "),
      detail: item.album.name, albumUri: item.album.uri, artwork: image(item.album.images),
    })),
    ...(data.albums?.items || []).map((item) => ({
      type: "album", uri: item.uri, title: item.name, subtitle: item.artists.map((artist) => artist.name).join(", "),
      detail: "Vis album", albumUri: item.uri, artwork: image(item.images),
    })),
    ...(data.artists?.items || []).map((item) => ({
      type: "artist", uri: item.uri, title: item.name, subtitle: "Artist", detail: "", artwork: image(item.images),
    })),
    ...(data.playlists?.items || []).filter(Boolean).map((item) => ({
      type: "playlist", uri: item.uri, title: item.name, subtitle: item.owner?.display_name || "Playlist",
      detail: "Playlist", artwork: image(item.images),
    })),
  ];
}

function spotifyPlayerStatus(playback, deviceName) {
  if (!playback?.item || playback.item.type !== "track" || playback.device?.name !== deviceName) return null;
  return {
    status: playback.is_playing ? "play" : "pause",
    curpos: Number(playback.progress_ms) || 0,
    totlen: Number(playback.item.duration_ms) || 0,
    Title: playback.item.name || "",
    Artist: playback.item.artists?.map((artist) => artist.name).join(", ") || "",
    Album: playback.item.album?.name || "",
    artwork: playback.item.album?.images?.[0]?.url || null,
    spotifyUri: playback.item.uri || null,
    mediaType: "track",
  };
}

async function getSpotifyPlayerStatus(deviceName) {
  if (!spotifyTokens || !deviceName) return null;
  if (spotifyPlaybackCache.expiresAt > Date.now()) return spotifyPlaybackCache.value;
  try {
    const value = spotifyPlayerStatus(await spotifyFetch("/me/player"), deviceName);
    spotifyPlaybackCache = { expiresAt: Date.now() + 3000, value };
    return value;
  } catch {
    return null;
  }
}

function escapeXml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}

function decodeXml(value = "") {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replaceAll("&quot;", '"').replaceAll("&apos;", "'")
    .replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&");
}

function xmlValue(xml, tag) {
  const match = xml.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match ? decodeXml(match[1].trim()) : "";
}

function xmlAttribute(attributes, name) {
  const match = attributes.match(new RegExp(`${name}="([^"]*)"`, "i"));
  return match ? decodeXml(match[1]) : "";
}

function mediaArtworkUrl(value, baseUrl) {
  if (!value) return null;
  try {
    const url = new URL(value, baseUrl);
    return new Set(["http:", "https:"]).has(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

function parseMediaResponse(soap, baseUrl) {
  const didl = decodeXml(xmlValue(soap, "Result"));
  const items = [...didl.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)].map((match) => {
    const item = match[1];
    const resource = item.match(/<res\b([^>]*)>([\s\S]*?)<\/res>/i);
    return {
      type: "item",
      mediaClass: xmlValue(item, "upnp:class"),
      title: xmlValue(item, "dc:title"),
      artist: xmlValue(item, "upnp:artist") || xmlValue(item, "dc:creator"),
      album: xmlValue(item, "upnp:album"),
      track: Number(xmlValue(item, "upnp:originalTrackNumber")) || null,
      duration: resource?.[1].match(/duration="([^"]+)"/i)?.[1] || "",
      url: resource ? decodeXml(resource[2].trim()) : "",
      artwork: mediaArtworkUrl(xmlValue(item, "upnp:albumArtURI"), baseUrl),
    };
  }).filter((item) => item.url && item.mediaClass.startsWith("object.item.audioItem"));
  const containers = [...didl.matchAll(/<container\b([^>]*)>([\s\S]*?)<\/container>/gi)].map((match) => ({
    type: "container",
    id: xmlAttribute(match[1], "id"),
    title: xmlValue(match[2], "dc:title"),
    childCount: Number(xmlAttribute(match[1], "childCount")) || 0,
    artwork: mediaArtworkUrl(xmlValue(match[2], "upnp:albumArtURI"), baseUrl),
  }));
  return { items, containers, total: Number(xmlValue(soap, "TotalMatches")) || items.length + containers.length };
}

function currentPlayerStatus(status, playback) {
  if (!playback) return status;
  const directMode = new Set(["10", "20", "21"]).has(String(status.mode));
  if (!directMode) return status;
  const { startedAt, ...metadata } = playback;
  return { ...status, ...metadata };
}

function unknownDirectPlaybackStatus(status, hasPlaybackMetadata) {
  const directMode = new Set(["10", "20", "21"]).has(String(status.mode));
  if (!directMode || hasPlaybackMetadata) return status;
  return {
    ...status,
    Title: "Ekstern afspilning",
    Artist: "Vælg nummeret i controlleren for at vise metadata",
    Album: "",
    artwork: null,
    disableArtwork: true,
  };
}

async function queryMediaServer(criteria, server, { start = 0, count = 20, sort = "+dc:title", containerId = "1" } = {}) {
  const body = `<?xml version="1.0"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body><u:Search xmlns:u="urn:schemas-upnp-org:service:ContentDirectory:1"><ContainerID>${escapeXml(containerId)}</ContainerID><SearchCriteria>${escapeXml(criteria)}</SearchCriteria><Filter>*</Filter><StartingIndex>${start}</StartingIndex><RequestedCount>${count}</RequestedCount><SortCriteria>${escapeXml(sort)}</SortCriteria></u:Search></s:Body></s:Envelope>`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6000);
  try {
    const response = await fetch(`${server.url}/ctl/ContentDir`, {
      method: "POST",
      headers: {
        "Content-Type": "text/xml; charset=utf-8",
        SOAPAction: '"urn:schemas-upnp-org:service:ContentDirectory:1#Search"',
      },
      body,
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`${server.name} svarede med HTTP ${response.status}`);
    return parseMediaResponse(await response.text(), server.url);
  } finally {
    clearTimeout(timeout);
  }
}

async function browseMediaServer(objectId, server) {
  const body = `<?xml version="1.0"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body><u:Browse xmlns:u="urn:schemas-upnp-org:service:ContentDirectory:1"><ObjectID>${escapeXml(objectId)}</ObjectID><BrowseFlag>BrowseDirectChildren</BrowseFlag><Filter>*</Filter><StartingIndex>0</StartingIndex><RequestedCount>500</RequestedCount><SortCriteria></SortCriteria></u:Browse></s:Body></s:Envelope>`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6000);
  try {
    const response = await fetch(`${server.url}/ctl/ContentDir`, {
      method: "POST",
      headers: {
        "Content-Type": "text/xml; charset=utf-8",
        SOAPAction: '"urn:schemas-upnp-org:service:ContentDirectory:1#Browse"',
      },
      body,
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`${server.name} svarede med HTTP ${response.status}`);
    return parseMediaResponse(await response.text(), server.url);
  } finally {
    clearTimeout(timeout);
  }
}

function escapeSearchValue(value) {
  return String(value).replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

function searchMediaServer(query, server, page, containerId = "1") {
  const value = escapeSearchValue(query);
  const criteria = `(dc:title contains "${value}" or upnp:artist contains "${value}" or upnp:album contains "${value}") and upnp:class derivedfrom "object.item.audioItem"`;
  return queryMediaServer(criteria, server, { start: (page - 1) * 20, containerId });
}

async function getAlbum(album, server) {
  const value = escapeSearchValue(album);
  const criteria = `upnp:album = "${value}" and upnp:class derivedfrom "object.item.audioItem"`;
  const result = await queryMediaServer(criteria, server, { count: 200, sort: "+upnp:originalTrackNumber" });
  result.items.sort((a, b) => (a.track || Number.MAX_SAFE_INTEGER) - (b.track || Number.MAX_SAFE_INTEGER));
  return result;
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 65_536) throw new Error("Request body is too large");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

async function deviceCommand(command) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4000);
  try {
    const url = `http://${config.deviceIp}/httpapi.asp?command=${encodeURIComponent(command)}`;
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`Enheden svarede med HTTP ${response.status}`);
    const text = await response.text();
    try {
      return JSON.parse(text);
    } catch {
      return { result: text.trim() || "OK" };
    }
  } finally {
    clearTimeout(timeout);
  }
}

async function api(request, response, pathname) {
  if (request.method === "GET" && pathname === "/api/spotify/login") {
    if (!config.spotifyClientId) return redirect(response, "/?spotifyError=Tilfoej%20Spotify%20Client%20ID%20i%20Indstillinger");
    const verifier = base64Url(crypto.randomBytes(64));
    const state = base64Url(crypto.randomBytes(24));
    const redirectUri = getSpotifyRedirectUri(request);
    spotifyAuthorization = { verifier, state, redirectUri, createdAt: Date.now() };
    const challenge = base64Url(crypto.createHash("sha256").update(verifier).digest());
    const authorize = new URL("https://accounts.spotify.com/authorize");
    authorize.search = new URLSearchParams({
      client_id: config.spotifyClientId,
      response_type: "code",
      redirect_uri: redirectUri,
      code_challenge_method: "S256",
      code_challenge: challenge,
      state,
      scope: "user-read-playback-state user-modify-playback-state user-read-currently-playing",
    });
    return redirect(response, authorize.href);
  }

  if (request.method === "GET" && pathname === "/api/spotify/callback") {
    const params = new URL(request.url, "http://localhost").searchParams;
    if (params.get("error")) return redirect(response, `/?spotifyError=${encodeURIComponent(params.get("error"))}`);
    if (!spotifyAuthorization || params.get("state") !== spotifyAuthorization.state || Date.now() - spotifyAuthorization.createdAt > 600_000) {
      spotifyAuthorization = null;
      return redirect(response, "/?spotifyError=Ugyldig%20eller%20udloebet%20Spotify-login");
    }
    try {
      const token = await exchangeSpotifyToken({
        grant_type: "authorization_code",
        code: params.get("code"),
        redirect_uri: spotifyAuthorization.redirectUri,
        client_id: config.spotifyClientId,
        code_verifier: spotifyAuthorization.verifier,
      });
      saveSpotifyTokens({ ...token, expires_at: Date.now() + token.expires_in * 1000 });
      spotifyAuthorization = null;
      return redirect(response, "/?spotify=connected");
    } catch (error) {
      spotifyAuthorization = null;
      return redirect(response, `/?spotifyError=${encodeURIComponent(error.message)}`);
    }
  }

  if (request.method === "GET" && pathname === "/api/spotify/status") {
    const redirectUri = getSpotifyRedirectUri(request);
    if (!config.spotifyClientId) return sendJson(response, 200, { configured: false, connected: false, redirectUri });
    if (!spotifyTokens) return sendJson(response, 200, { configured: true, connected: false, redirectUri });
    try {
      const profile = await spotifyFetch("/me");
      return sendJson(response, 200, {
        configured: true,
        connected: true,
        redirectUri,
        user: { name: profile.display_name || profile.id, image: profile.images?.[0]?.url || null },
      });
    } catch (error) {
      if (/token|authentication|access/i.test(error.message)) clearSpotifyTokens();
      return sendJson(response, 200, { configured: true, connected: false, redirectUri, error: error.message });
    }
  }

  if (request.method === "POST" && pathname === "/api/spotify/disconnect") {
    clearSpotifyTokens();
    return sendJson(response, 200, { connected: false });
  }

  if (request.method === "GET" && pathname === "/api/spotify/search") {
    const query = new URL(request.url, "http://localhost").searchParams.get("q")?.trim();
    if (!query || query.length < 2 || query.length > 100) return sendJson(response, 400, { error: "Søg med mindst 2 tegn" });
    const params = new URLSearchParams({ q: query, type: "track,album,artist,playlist", limit: "10" });
    return sendJson(response, 200, { items: spotifySearchResults(await spotifyFetch(`/search?${params}`)) });
  }

  if (request.method === "GET" && pathname === "/api/spotify/devices") {
    const data = await spotifyFetch("/me/player/devices");
    return sendJson(response, 200, {
      devices: data.devices.map((device) => ({ id: device.id, name: device.name, type: device.type, active: device.is_active })),
    });
  }

  if (request.method === "GET" && pathname === "/api/spotify/album") {
    const uri = new URL(request.url, "http://localhost").searchParams.get("uri") || "";
    const match = uri.match(/^spotify:album:([A-Za-z0-9]+)$/);
    if (!match) return sendJson(response, 400, { error: "Ugyldigt Spotify-album" });
    const album = await spotifyFetch(`/albums/${match[1]}`);
    const tracks = [...album.tracks.items];
    let next = album.tracks.next;
    while (next && tracks.length < 200) {
      const nextUrl = new URL(next);
      const page = await spotifyFetch(`${nextUrl.pathname.replace(/^\/v1/, "")}${nextUrl.search}`);
      tracks.push(...page.items);
      next = page.next;
    }
    const artwork = album.images?.[0]?.url || null;
    return sendJson(response, 200, {
      album: album.name,
      artist: album.artists.map((artist) => artist.name).join(", "),
      items: tracks.map((track) => ({
        type: "track",
        uri: track.uri,
        title: `${album.total_tracks > 1 ? `${track.disc_number > 1 ? `${track.disc_number}.` : ""}${track.track_number}. ` : ""}${track.name}`,
        subtitle: track.artists.map((artist) => artist.name).join(", "),
        detail: album.name,
        albumUri: album.uri,
        artwork,
      })),
    });
  }

  if (request.method === "POST" && pathname === "/api/spotify/play") {
    const body = await readJson(request);
    if (!/^spotify:(track|album|artist|playlist):[A-Za-z0-9]+$/.test(body.uri || "")) {
      return sendJson(response, 400, { error: "Ugyldigt Spotify-indhold" });
    }
    const devices = await spotifyFetch("/me/player/devices");
    const device = devices.devices.find((item) => item.id === body.deviceId) || devices.devices.find((item) => item.is_active);
    if (!device) return sendJson(response, 409, { error: "iEast er ikke synlig i Spotify Connect. Åbn Spotify-appen og vælg enheden én gang." });
    await spotifyFetch("/me/player", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ device_ids: [device.id], play: false }),
    });
    await new Promise((resolve) => setTimeout(resolve, 250));
    const playBody = body.uri.startsWith("spotify:track:") ? { uris: [body.uri] } : { context_uri: body.uri };
    await spotifyFetch(`/me/player/play?device_id=${encodeURIComponent(device.id)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(playBody),
    });
    saveDirectPlayback(null);
    return sendJson(response, 200, { playing: true, device: device.name });
  }

  if (request.method === "GET" && pathname === "/api/config") {
    return sendJson(response, 200, publicConfig());
  }

  if (request.method === "PUT" && pathname === "/api/config") {
    saveConfig(await readJson(request));
    return sendJson(response, 200, publicConfig());
  }

  if (request.method === "GET" && pathname === "/api/status") {
    const status = await deviceCommand("getPlayerStatus");
    if (!streamerName && spotifyTokens) {
      try {
        streamerName = (await deviceCommand("getStatusEx")).DeviceName || "";
      } catch {
        // LinkPlay status remains available when extended device details fail.
      }
    }
    const spotifyStatus = await getSpotifyPlayerStatus(streamerName);
    if (spotifyStatus) {
      saveDirectPlayback(null);
      return sendJson(response, 200, { ...status, ...spotifyStatus });
    }
    const directMode = new Set(["10", "20", "21"]).has(String(status.mode));
    if (directPlayback && !directMode) saveDirectPlayback(null);
    const current = currentPlayerStatus(unknownDirectPlaybackStatus(status, Boolean(directPlayback)), directPlayback);
    return sendJson(response, 200, current);
  }

  if (request.method === "GET" && pathname === "/api/device") {
    const data = await deviceCommand("getStatusEx");
    streamerName = data.DeviceName || streamerName;
    return sendJson(response, 200, {
      name: data.DeviceName,
      firmware: data.firmware,
      project: data.project,
      ip: config.deviceIp,
      signal: Number(data.RSSI),
    });
  }

  if (request.method === "GET" && pathname === "/api/artwork") {
    const params = new URL(request.url, "http://localhost").searchParams;
    const artist = params.get("artist")?.trim();
    const title = params.get("title")?.trim();
    if (!title || title.length > 300 || (artist && artist.length > 200)) {
      return sendJson(response, 400, { error: "Ugyldige metadata" });
    }
    const key = `${artist || ""}\n${title}`.toLocaleLowerCase();
    if (artworkCache.has(key)) return sendJson(response, 200, artworkCache.get(key));

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      const term = [artist, title].filter(Boolean).join(" ");
      const lookup = new URL("https://itunes.apple.com/search");
      lookup.search = new URLSearchParams({ term, entity: "song", limit: "5" });
      const result = await fetch(lookup, { signal: controller.signal }).then((item) => item.json());
      const match = result.results?.[0];
      const payload = match ? {
        url: match.artworkUrl100?.replace("100x100bb", "600x600bb"),
        album: match.collectionName,
      } : { url: null };
      artworkCache.set(key, payload);
      return sendJson(response, 200, payload);
    } finally {
      clearTimeout(timeout);
    }
  }

  if (request.method === "GET" && pathname === "/api/library/search") {
    const params = new URL(request.url, "http://localhost").searchParams;
    const query = params.get("q")?.trim();
    if (!query || query.length < 2 || query.length > 100) {
      return sendJson(response, 400, { error: "Søg med mindst 2 tegn" });
    }
    const page = Math.max(1, Number.parseInt(params.get("page"), 10) || 1);
    const containerId = params.get("container") || "1";
    if (containerId.length > 500) return sendJson(response, 400, { error: "Ugyldig mappe" });
    const server = config.mediaServers.find((item) => item.id === params.get("server")) || config.mediaServers[0];
    if (!server) return sendJson(response, 400, { error: "Tilføj først en medieserver i indstillinger" });
    const result = await searchMediaServer(query, server, page, containerId);
    const pages = Math.max(1, Math.ceil(result.total / 20));
    return sendJson(response, 200, { ...result, server: server.name, page: Math.min(page, pages), pages });
  }

  if (request.method === "GET" && pathname === "/api/library/album") {
    const params = new URL(request.url, "http://localhost").searchParams;
    const album = params.get("album")?.trim();
    if (!album || album.length > 300) return sendJson(response, 400, { error: "Ugyldigt album" });
    const server = config.mediaServers.find((item) => item.id === params.get("server")) || config.mediaServers[0];
    if (!server) return sendJson(response, 400, { error: "Tilføj først en medieserver i indstillinger" });
    return sendJson(response, 200, { ...await getAlbum(album, server), server: server.name, album });
  }

  if (request.method === "GET" && pathname === "/api/library/browse") {
    const params = new URL(request.url, "http://localhost").searchParams;
    const objectId = params.get("id") || "0";
    if (objectId.length > 500) return sendJson(response, 400, { error: "Ugyldig mappe" });
    const server = config.mediaServers.find((item) => item.id === params.get("server")) || config.mediaServers[0];
    if (!server) return sendJson(response, 400, { error: "Tilføj først en medieserver i indstillinger" });
    return sendJson(response, 200, { ...await browseMediaServer(objectId, server), server: server.name, objectId });
  }

  if (request.method === "POST" && pathname === "/api/command") {
    const body = await readJson(request);
    let command;
    if (playerCommands.has(body.action)) {
      command = `setPlayerCmd:${body.action}`;
    } else if (body.action === "mute" || body.action === "unmute") {
      command = `setPlayerCmd:mute:${body.action === "mute" ? 1 : 0}`;
    } else if (body.action === "volume" && Number.isInteger(body.value) && body.value >= 0 && body.value <= 100) {
      command = `setPlayerCmd:vol:${body.value}`;
    } else if (body.action === "seek" && Number.isInteger(body.value) && body.value >= 0) {
      command = `setPlayerCmd:seek:${Math.floor(body.value / 1000)}`;
    } else {
      return sendJson(response, 400, { error: "Ugyldig kommando" });
    }
    const result = await deviceCommand(command);
    if (body.action === "stop") saveDirectPlayback(null);
    return sendJson(response, 200, result);
  }

  if (request.method === "POST" && pathname === "/api/stream") {
    const body = await readJson(request);
    let streamUrl;
    try {
      streamUrl = new URL(body.url);
      if (!new Set(["http:", "https:"]).has(streamUrl.protocol)) throw new Error();
    } catch {
      return sendJson(response, 400, { error: "Indtast en gyldig http- eller https-URL" });
    }
    const result = await deviceCommand(`setPlayerCmd:play:${streamUrl.href}`);
    const metadata = body.metadata;
    saveDirectPlayback(metadata?.title ? {
      Title: String(metadata.title).slice(0, 300),
      Artist: String(metadata.artist || "").slice(0, 200),
      Album: String(metadata.album || "").slice(0, 300),
      artwork: typeof metadata.artwork === "string" ? metadata.artwork : null,
      disableArtwork: metadata.disableArtwork === true,
      mediaType: metadata.mediaType === "radio" ? "radio" : "track",
      startedAt: Date.now(),
    } : null);
    return sendJson(response, 200, result);
  }

  return sendJson(response, 404, { error: "Ikke fundet" });
}

function serveStatic(response, pathname) {
  const requested = pathname === "/" ? "index.html" : pathname.slice(1);
  const filePath = path.resolve(PUBLIC_DIR, requested);
  if (!filePath.startsWith(`${PUBLIC_DIR}${path.sep}`) && filePath !== path.join(PUBLIC_DIR, "index.html")) {
    response.writeHead(403).end("Forbidden");
    return;
  }
  fs.readFile(filePath, (error, data) => {
    if (error) {
      response.writeHead(error.code === "ENOENT" ? 404 : 500).end("Not found");
      return;
    }
    response.writeHead(200, {
      "Content-Type": contentTypes[path.extname(filePath)] || "application/octet-stream",
      "Cache-Control": "no-cache",
    });
    response.end(data);
  });
}

const server = http.createServer(async (request, response) => {
  const pathname = new URL(request.url, `http://${request.headers.host || "localhost"}`).pathname;
  try {
    if (pathname.startsWith("/api/")) await api(request, response, pathname);
    else serveStatic(response, pathname);
  } catch (error) {
    const unavailable = error.name === "AbortError" || error.cause?.code;
    sendJson(response, unavailable ? 503 : 500, {
      error: unavailable ? `Kan ikke få kontakt til den valgte enhed eller server` : error.message,
    });
  }
});

if (require.main === module) {
  server.listen(PORT, HOST, () => {
    console.log(`iEast Controller: http://localhost:${PORT}`);
    console.log(`Streamer: http://${config.deviceIp}`);
  });
}

module.exports = { currentPlayerStatus, parseMediaResponse, spotifyPlayerStatus, unknownDirectPlaybackStatus, server };
