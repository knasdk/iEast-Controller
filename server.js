const http = require("node:http");
const net = require("node:net");
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

loadEnvFile(process.env.ENV_FILE || path.join(__dirname, ".env"));

const HOST = process.env.HOST || "0.0.0.0";
const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(__dirname, "public");
const STATE_DIR = path.resolve(process.env.STATE_DIR || path.join(__dirname, ".state"));
const SETTINGS_FILE = path.join(STATE_DIR, "settings.json");
const SPOTIFY_FILE = path.join(STATE_DIR, "spotify.json");
const PLAYBACK_FILE = path.join(STATE_DIR, "playback.json");
const QUEUE_FILE = path.join(STATE_DIR, "queue.json");
const SPOTIFY_REDIRECT_URI = process.env.SPOTIFY_REDIRECT_URI || "";
const artworkCache = new Map();
let directPlayback = null;
let spotifyAuthorization = null;
let streamerName = "";
let spotifyPlaybackCache = { expiresAt: 0, value: null };
let playerStatusRequest = null;
let queueRuntime = null;
let queueBusy = false;
let queuePollTimer = null;

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
  language: "da",
};
const supportedLanguages = new Set(["da", "en", "sv", "nb", "de"]);

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
let config = {
  ...defaultConfig,
  deviceIp: settings.deviceIp || defaultConfig.deviceIp,
  spotifyClientId: typeof settings.spotifyClientId === "string" ? settings.spotifyClientId : defaultConfig.spotifyClientId,
  language: supportedLanguages.has(settings.language) ? settings.language : defaultConfig.language,
  mediaServers: Array.isArray(settings.mediaServers) ? settings.mediaServers : defaultConfig.mediaServers,
  radios: Array.isArray(settings.radios) ? settings.radios : defaultRadios,
};
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
const emptyQueue = () => ({
  items: [], originalItems: null, index: -1, state: "stopped",
  options: { autoNext: true, continueAlbums: false, shuffle: false },
});
let queueStore = { version: 1, revision: 0, queue: emptyQueue(), playlists: [] };
try {
  const savedQueue = JSON.parse(fs.readFileSync(QUEUE_FILE, "utf8"));
  queueStore = {
    version: 1,
    revision: Number(savedQueue.revision) || 0,
    queue: { ...emptyQueue(), ...savedQueue.queue, state: "stopped" },
    playlists: Array.isArray(savedQueue.playlists) ? savedQueue.playlists : [],
  };
} catch {
  // Queue state is created when the first item is added.
}

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
};

const playerCommands = new Set(["play", "pause", "stop", "next", "prev"]);

const errorCodes = new Map([
  ["Ugyldig konfiguration", "INVALID_CONFIG"],
  ["Indtast en gyldig iEast IP-adresse", "INVALID_DEVICE_IP"],
  ["Ikke-understøttet sprog", "INVALID_LANGUAGE"],
  ["For mange poster", "TOO_MANY_ENTRIES"],
  ["Alle medieservere skal have et navn", "MEDIA_SERVER_NAME_REQUIRED"],
  ["Alle radiolinks skal have et navn", "RADIO_NAME_REQUIRED"],
  ["Spotify er ikke forbundet", "SPOTIFY_NOT_CONNECTED"],
  ["Medieserveren findes ikke længere", "MEDIA_SERVER_NOT_FOUND"],
  ["Søg med mindst 2 tegn", "SEARCH_QUERY_INVALID"],
  ["Ugyldigt Spotify-album", "SPOTIFY_ALBUM_INVALID"],
  ["Ugyldigt Spotify-indhold", "SPOTIFY_CONTENT_INVALID"],
  ["iEast er ikke synlig i Spotify Connect. Åbn Spotify-appen og vælg enheden én gang.", "SPOTIFY_DEVICE_UNAVAILABLE"],
  ["Den valgte iEast-enhed kan ikke aflæse tonekontrol", "TONE_UNSUPPORTED"],
  ["Ugyldig toneindstilling", "TONE_INVALID"],
  ["Vælg mindst ét nummer eller album", "SELECTION_REQUIRED"],
  ["Valget indeholder ingen afspillelige numre", "SELECTION_NOT_PLAYABLE"],
  ["Ugyldigt nummer i køen", "QUEUE_ITEM_INVALID"],
  ["Afspilningslisten skal have et navn", "PLAYLIST_NAME_REQUIRED"],
  ["Afspilningslisten er tom", "PLAYLIST_EMPTY"],
  ["Afspilningslisten indeholder ingen afspillelige numre", "PLAYLIST_NOT_PLAYABLE"],
  ["Afspilningslisten findes ikke", "PLAYLIST_NOT_FOUND"],
  ["Ugyldige metadata", "METADATA_INVALID"],
  ["Ugyldig mappe", "FOLDER_INVALID"],
  ["Tilføj først en medieserver i indstillinger", "MEDIA_SERVER_REQUIRED"],
  ["Ugyldigt album", "ALBUM_INVALID"],
  ["Ugyldig kommando", "COMMAND_INVALID"],
  ["Indtast en gyldig http- eller https-URL", "URL_INVALID"],
  ["Ugyldig medieserver-adresse", "URL_INVALID"],
  ["Request body is too large", "REQUEST_TOO_LARGE"],
  ["Ikke fundet", "NOT_FOUND"],
]);

function errorCodeFor(message) {
  if (errorCodes.has(message)) return errorCodes.get(message);
  if (/^Ugyldigt radiolink/.test(message) || /^Ugyldigt radiologo/.test(message)) return "URL_INVALID";
  if (/svarede med HTTP/.test(message) || /svarede ikke/.test(message)) return "CONNECTION_UNAVAILABLE";
  return "ACTION_FAILED";
}

function sendJson(response, status, payload) {
  if (payload?.error && !payload.errorCode) payload = { ...payload, errorCode: errorCodeFor(payload.error) };
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

function saveQueueStore() {
  queueStore.revision += 1;
  const temporary = `${QUEUE_FILE}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(queueStore, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, QUEUE_FILE);
  fs.chmodSync(QUEUE_FILE, 0o600);
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
  const deviceIp = String(input.deviceIp || "").trim();
  if (!isIpAddress(deviceIp)) throw new Error("Indtast en gyldig iEast IP-adresse");
  const language = input.language == null ? "da" : String(input.language);
  if (!supportedLanguages.has(language)) throw new Error("Ikke-understøttet sprog");
  if (!Array.isArray(input.mediaServers) || !Array.isArray(input.radios)) throw new Error("Ugyldig konfiguration");
  if (input.mediaServers.length > 20 || input.radios.length > 100) throw new Error("For mange poster");
  return {
    deviceIp,
    language,
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
  const previousClientId = config.spotifyClientId;
  config = normalizeConfig({ ...config, ...nextConfig });
  if (config.spotifyClientId !== previousClientId) clearSpotifyTokens();
  if (SETTINGS_FILE) {
    const temporary = `${SETTINGS_FILE}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(temporary, SETTINGS_FILE);
    fs.chmodSync(SETTINGS_FILE, 0o600);
  }
  return config;
}

function toneCommand(action, value) {
  const prefixes = { treble: "1", bass: "2" };
  if (!prefixes[action] || !Number.isInteger(value) || value < -12 || value > 12 || value % 2 !== 0) return null;
  const progress = value < 0 ? 6 + value / 2 : value > 0 ? 7 + value / 2 : 6;
  return `MCU+PAS+${prefixes[action]}${String(progress + 1).padStart(2, "0")}&`;
}

function toneFromDevice(payloads) {
  const tone = {};
  for (const match of String(Array.isArray(payloads) ? payloads.join("") : payloads || "").matchAll(/MCU\+PAS\+([12])(\d{2})&/g)) {
    const progress = Number(match[2]) - 1;
    const value = progress < 6 ? (progress - 6) * 2 : progress > 7 ? (progress - 7) * 2 : 0;
    tone[match[1] === "1" ? "treble" : "bass"] = value;
  }
  return Number.isFinite(tone.bass) && Number.isFinite(tone.treble) ? tone : null;
}

function mcuFrame(command) {
  const frame = Buffer.alloc(20 + Buffer.byteLength(command));
  frame.writeUInt32LE(538482200, 0);
  frame.writeUInt32LE(Buffer.byteLength(command), 4);
  frame.write(command, 20);
  return frame;
}

function mcuCommand(command, complete) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: config.deviceIp, port: 8899 });
    const payloads = [];
    let pending = Buffer.alloc(0);
    let settled = false;
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (error) reject(error);
      else resolve(result);
    };

    socket.setTimeout(3000);
    socket.on("connect", () => socket.write(mcuFrame(command)));
    socket.on("timeout", () => finish(new Error("Enheden svarede ikke på tonekommandoen")));
    socket.on("error", (error) => finish(error));
    socket.on("data", (chunk) => {
      pending = Buffer.concat([pending, chunk]);
      while (pending.length >= 20) {
        const magic = pending.readUInt32LE(0);
        const length = pending.readUInt32LE(4);
        if (magic !== 538482200 || length > 65_536) return finish(new Error("Enheden sendte et ugyldigt tonesvar"));
        if (pending.length < 20 + length) return;
        payloads.push(pending.subarray(20, 20 + length).toString());
        pending = pending.subarray(20 + length);
        const result = complete(payloads);
        if (result) return finish(null, result);
      }
    });
  });
}

function getDeviceTone() {
  return mcuCommand("MCU+PAS+EQGet&", toneFromDevice);
}

function sendMcuCommand(command) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: config.deviceIp, port: 8899 });
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (error) reject(error);
      else resolve();
    };
    socket.setTimeout(3000);
    socket.on("timeout", () => finish(new Error("Enheden svarede ikke på tonekommandoen")));
    socket.on("error", finish);
    socket.on("connect", () => socket.write(mcuFrame(command), finish));
  });
}

async function setDeviceTone(command) {
  await sendMcuCommand(command);
  await new Promise((resolve) => setTimeout(resolve, 100));
  return getDeviceTone();
}

function publicConfig() {
  return { ...config, spotifyConfigured: Boolean(config.spotifyClientId) };
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
      detail: "", albumUri: item.uri, artwork: image(item.images),
    })),
    ...(data.artists?.items || []).map((item) => ({
      type: "artist", uri: item.uri, title: item.name, subtitle: "", detail: "", artwork: image(item.images),
    })),
    ...(data.playlists?.items || []).filter(Boolean).map((item) => ({
      type: "playlist", uri: item.uri, title: item.name, subtitle: item.owner?.display_name || "",
      detail: "", artwork: image(item.images),
    })),
  ];
}

function spotifyPlayerStatus(playback, deviceName, deviceStatus) {
  if (!playback?.item || playback.item.type !== "track" || playback.device?.name !== deviceName) return null;
  const status = String(deviceStatus?.status || "").toLowerCase();
  if (status === "stop" || (["play", "playing"].includes(status) && !playback.is_playing) || (status === "pause" && playback.is_playing)) return null;
  return {
    status: playback.is_playing ? "play" : "pause",
    curpos: Number(playback.progress_ms) || 0,
    totlen: Number(playback.item.duration_ms) || 0,
    Title: playback.item.name || "",
    Artist: playback.item.artists?.map((artist) => artist.name).join(", ") || "",
    Album: playback.item.album?.name || "",
    albumUri: playback.item.album?.uri || null,
    artwork: playback.item.album?.images?.[0]?.url || null,
    spotifyUri: playback.item.uri || null,
    mediaType: "track",
  };
}

async function getSpotifyPlayerStatus(deviceName, deviceStatus) {
  if (!spotifyTokens || !deviceName) return null;
  try {
    let playback = spotifyPlaybackCache.value;
    if (spotifyPlaybackCache.expiresAt <= Date.now()) {
      playback = await spotifyFetch("/me/player");
      spotifyPlaybackCache = { expiresAt: Date.now() + 3000, value: playback };
    }
    return spotifyPlayerStatus(playback, deviceName, deviceStatus);
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

function durationMilliseconds(value) {
  const parts = String(value || "").split(":").map(Number);
  if (parts.length !== 3 || parts.some((part) => !Number.isFinite(part))) return 0;
  return Math.round((parts[0] * 3600 + parts[1] * 60 + parts[2]) * 1000);
}

function parseMediaResponse(soap, baseUrl) {
  const didl = decodeXml(xmlValue(soap, "Result"));
  const items = [...didl.matchAll(/<item\b([^>]*)>([\s\S]*?)<\/item>/gi)].map((match) => {
    const item = match[2];
    const resource = item.match(/<res\b([^>]*)>([\s\S]*?)<\/res>/i);
    return {
      type: "item",
      id: xmlAttribute(match[1], "id"),
      parentId: xmlAttribute(match[1], "parentID"),
      mediaClass: xmlValue(item, "upnp:class"),
      title: xmlValue(item, "dc:title"),
      artist: xmlValue(item, "upnp:artist") || xmlValue(item, "dc:creator"),
      album: xmlValue(item, "upnp:album"),
      track: Number(xmlValue(item, "upnp:originalTrackNumber")) || null,
      duration: resource?.[1].match(/duration="([^"]+)"/i)?.[1] || "",
      durationMs: durationMilliseconds(resource?.[1].match(/duration="([^"]+)"/i)?.[1]),
      url: resource ? decodeXml(resource[2].trim()) : "",
      artwork: mediaArtworkUrl(xmlValue(item, "upnp:albumArtURI"), baseUrl),
    };
  }).filter((item) => item.url && item.mediaClass.startsWith("object.item.audioItem"));
  const containers = [...didl.matchAll(/<container\b([^>]*)>([\s\S]*?)<\/container>/gi)].map((match) => ({
    type: "container",
    id: xmlAttribute(match[1], "id"),
    parentId: xmlAttribute(match[1], "parentID"),
    mediaClass: xmlValue(match[2], "upnp:class"),
    title: xmlValue(match[2], "dc:title"),
    childCount: Number(xmlAttribute(match[1], "childCount")) || 0,
    artwork: mediaArtworkUrl(xmlValue(match[2], "upnp:albumArtURI"), baseUrl),
  }));
  return {
    items,
    containers,
    numberReturned: Number(xmlValue(soap, "NumberReturned")) || items.length + containers.length,
    total: Number(xmlValue(soap, "TotalMatches")) || items.length + containers.length,
  };
}

function decodeDeviceText(value) {
  const text = String(value || "");
  if (!text || text.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(text)) return text;
  const decoded = Buffer.from(text, "hex").toString("utf8").trim();
  return decoded.includes("\uFFFD") ? text : decoded;
}

function playbackTitle(value) {
  return decodeDeviceText(value?.Title || value?.title).normalize("NFKC").trim().toLocaleLowerCase();
}

function directPlaybackMatches(status, playback, now = Date.now()) {
  if (!playback || !new Set(["10", "20", "21"]).has(String(status.mode))) return false;
  if (now - Number(playback.startedAt || 0) < 5000) return true;
  const current = playbackTitle(status);
  if (!current) return true;
  return current === playbackTitle(playback) || current === playbackTitle(playback.deviceStatusAtStart);
}

function currentPlayerStatus(status, playback, now = Date.now()) {
  if (!playback) return status;
  if (!directPlaybackMatches(status, playback, now)) return status;
  const { deviceStatusAtStart, startedAt, ...metadata } = playback;
  return { ...status, ...metadata };
}

function unknownDirectPlaybackStatus(status, hasPlaybackMetadata) {
  const directMode = new Set(["10", "20", "21"]).has(String(status.mode));
  if (!directMode || hasPlaybackMetadata) return status;
  if (status.Title || status.title) {
    return { ...status, mediaType: Number(status.totlen) > 0 ? "track" : "radio" };
  }
  return {
    ...status,
    Title: "Ekstern afspilning",
    Artist: "Vælg nummeret i controlleren for at vise metadata",
    metadataPlaceholder: "external-playback",
    Album: "",
    artwork: null,
    disableArtwork: true,
    curpos: 0,
    totlen: 0,
    mediaType: "radio",
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

async function browseMediaServer(objectId, server, { flag = "BrowseDirectChildren", start = 0, count = 500 } = {}) {
  const body = `<?xml version="1.0"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body><u:Browse xmlns:u="urn:schemas-upnp-org:service:ContentDirectory:1"><ObjectID>${escapeXml(objectId)}</ObjectID><BrowseFlag>${flag}</BrowseFlag><Filter>*</Filter><StartingIndex>${start}</StartingIndex><RequestedCount>${count}</RequestedCount><SortCriteria></SortCriteria></u:Browse></s:Body></s:Envelope>`;
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

async function browseAllChildren(objectId, server) {
  const result = { items: [], containers: [], total: 0 };
  let start = 0;
  do {
    const page = await browseMediaServer(objectId, server, { start, count: 500 });
    result.items.push(...page.items);
    result.containers.push(...page.containers);
    result.total = page.total;
    start += page.numberReturned;
    if (!page.numberReturned) break;
  } while (start < result.total && start < 10_000);
  return result;
}

async function browseMediaObject(objectId, server) {
  const result = await browseMediaServer(objectId, server, { flag: "BrowseMetadata", count: 0 });
  return result.containers[0] || result.items[0] || null;
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

function configuredMediaServer(serverId) {
  return config.mediaServers.find((server) => server.id === serverId);
}

function shuffled(items) {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const target = crypto.randomInt(index + 1);
    [result[index], result[target]] = [result[target], result[index]];
  }
  return result;
}

function shuffledQueue(items) {
  if (items.length < 2) return [...items];
  if (items.length === 2) return [items[1], items[0]];
  const originalIndexes = new Map(items.map((item, index) => [item, index]));
  const albumKey = (item) => String(item.album || item.queueItemId || item.objectId || "").normalize("NFKC").trim().toLocaleLowerCase();
  const scoreCandidate = (candidate) => {
    let displacement = 0;
    let fixed = 0;
    let oldNeighbours = 0;
    let sameAlbumNeighbours = 0;
    let albumRunPenalty = 0;
    let albumRunLength = 1;
    for (let index = 0; index < candidate.length; index += 1) {
      const originalIndex = originalIndexes.get(candidate[index]);
      displacement += Math.abs(originalIndex - index);
      if (originalIndex === index) fixed += 1;
      if (index && Math.abs(originalIndex - originalIndexes.get(candidate[index - 1])) === 1) oldNeighbours += 1;
      if (index && albumKey(candidate[index]) === albumKey(candidate[index - 1])) {
        sameAlbumNeighbours += 1;
        albumRunLength += 1;
      } else if (index) {
        albumRunPenalty += (albumRunLength - 1) ** 2;
        albumRunLength = 1;
      }
    }
    albumRunPenalty += (albumRunLength - 1) ** 2;
    return displacement
      - fixed * items.length * 8
      - oldNeighbours * items.length * 2
      - sameAlbumNeighbours * items.length * items.length * 2
      - albumRunPenalty * items.length * items.length * 4;
  };
  const interleaveAlbums = () => {
    const grouped = new Map();
    for (const item of items) {
      const key = albumKey(item);
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(item);
    }
    for (const [key, tracks] of grouped) grouped.set(key, shuffled(tracks));
    const result = [];
    const total = items.length;
    const albumWeights = new Map([...grouped].map(([key, tracks]) => [key, tracks.length]));
    const weights = new Map([...grouped].map(([key]) => [key, crypto.randomInt(total)]));
    while (result.length < items.length) {
      const available = [...grouped.entries()].filter(([, tracks]) => tracks.length);
      for (const [key] of available) weights.set(key, weights.get(key) + albumWeights.get(key));
      const largest = Math.max(...available.map(([key]) => weights.get(key)));
      const candidates = available.filter(([key]) => weights.get(key) === largest);
      const [key, tracks] = candidates[crypto.randomInt(candidates.length)];
      result.push(tracks.shift());
      weights.set(key, weights.get(key) - total);
    }
    return result;
  };
  let best = null;
  let bestScore = -Infinity;
  for (let attempt = 0; attempt < 128; attempt += 1) {
    const candidates = [interleaveAlbums()];
    const sattolo = [...items];
    for (let index = sattolo.length - 1; index > 0; index -= 1) {
      const target = crypto.randomInt(index);
      [sattolo[index], sattolo[target]] = [sattolo[target], sattolo[index]];
    }
    candidates.push(sattolo);
    for (const candidate of candidates) {
      const score = scoreCandidate(candidate);
      if (score > bestScore) {
        best = candidate;
        bestScore = score;
      }
    }
  }
  return best;
}

function queueTrack(item, serverId, originAlbum = null) {
  let url;
  try {
    url = new URL(item.url);
    if (!new Set(["http:", "https:"]).has(url.protocol)) return null;
  } catch {
    return null;
  }
  return {
    queueItemId: crypto.randomUUID(),
    type: "track",
    serverId: String(serverId || "").slice(0, 100),
    objectId: String(item.objectId || item.id || "").slice(0, 500),
    parentId: String(item.parentId || "").slice(0, 500),
    url: url.href,
    title: String(item.title || "Ukendt titel").slice(0, 300),
    titleMissing: !item.title,
    artist: String(item.artist || "").slice(0, 200),
    album: String(item.album || originAlbum?.title || "").slice(0, 300),
    artwork: typeof item.artwork === "string" ? item.artwork : null,
    durationMs: Math.max(0, Number(item.durationMs) || durationMilliseconds(item.duration)),
    track: Number(item.track) || null,
    originAlbum,
  };
}

async function expandAlbum(entry, shuffle = false) {
  const server = configuredMediaServer(entry.serverId);
  if (!server) throw new Error("Medieserveren findes ikke længere");
  let album = null;
  let result;
  if (entry.albumId) {
    album = await browseMediaObject(entry.albumId, server);
    result = await browseAllChildren(entry.albumId, server);
  } else {
    result = await getAlbum(entry.album, server);
  }
  const originAlbum = {
    id: String(entry.albumId || album?.id || ""),
    parentId: String(album?.parentId || entry.albumParentId || ""),
    title: String(album?.title || entry.album || "Album").slice(0, 300),
  };
  const ordered = [...result.items].sort((left, right) =>
    (left.track || Number.MAX_SAFE_INTEGER) - (right.track || Number.MAX_SAFE_INTEGER)
      || left.title.localeCompare(right.title, "da", { sensitivity: "base", numeric: true }));
  const tracks = ordered.map((item) => queueTrack(item, entry.serverId, originAlbum)).filter(Boolean);
  return shuffle ? shuffled(tracks) : tracks;
}

async function resolveQueueEntries(entries, shuffle = false) {
  const tracks = [];
  for (const entry of entries.slice(0, 2000)) {
    if (entry?.type === "album") tracks.push(...await expandAlbum(entry, shuffle));
    else if (entry?.type === "track") {
      const track = queueTrack(entry.track || entry, entry.serverId || entry.track?.serverId);
      if (track) tracks.push(track);
    }
    if (tracks.length >= 10_000) break;
  }
  return tracks.slice(0, 10_000);
}

async function playQueueIndex(index) {
  const item = queueStore.queue.items[index];
  if (!item) {
    await deviceCommand("setPlayerCmd:stop").catch(() => null);
    queueStore.queue.state = "stopped";
    queueStore.queue.index = queueStore.queue.items.length ? queueStore.queue.items.length - 1 : -1;
    queueRuntime = null;
    saveDirectPlayback(null);
    saveQueueStore();
    return null;
  }
  const deviceStatusAtStart = await getDevicePlayerStatus().catch(() => null);
  await deviceCommand(`setPlayerCmd:play:${item.url}`);
  queueStore.queue.index = index;
  queueStore.queue.state = "playing";
  saveDirectPlayback({
    Title: item.title, Artist: item.artist, Album: item.album, artwork: item.artwork,
    mediaType: "track", serverId: item.serverId, parentId: item.parentId,
    folderTitle: item.album, queueItemId: item.queueItemId, deviceStatusAtStart, startedAt: Date.now(),
  });
  queueRuntime = {
    queueItemId: item.queueItemId, confirmed: false, lastPosition: 0,
    maxPosition: 0, terminalSamples: 0, startedAt: Date.now(),
  };
  saveQueueStore();
  return item;
}

async function appendNextAlbum() {
  const current = queueStore.queue.items.at(-1)?.originAlbum;
  if (!current?.id) return false;
  const serverId = queueStore.queue.items.at(-1).serverId;
  const server = configuredMediaServer(serverId);
  if (!server) return false;
  let parentId = current.parentId;
  if (!parentId) parentId = (await browseMediaObject(current.id, server))?.parentId;
  if (!parentId) return false;
  const siblings = (await browseAllChildren(parentId, server)).containers
    .sort((left, right) => left.title.localeCompare(right.title, "da", { sensitivity: "base", numeric: true }) || left.id.localeCompare(right.id));
  const currentIndex = siblings.findIndex((album) => album.id === current.id);
  for (const sibling of siblings.slice(currentIndex + 1)) {
    const tracks = await expandAlbum({ type: "album", serverId, albumId: sibling.id, album: sibling.title }, queueStore.queue.options.shuffle);
    if (tracks.length) {
      queueStore.queue.items.push(...tracks);
      saveQueueStore();
      return true;
    }
  }
  return false;
}

async function advanceQueue(step = 1) {
  let nextIndex = queueStore.queue.index + step;
  if (nextIndex >= queueStore.queue.items.length && queueStore.queue.options.continueAlbums) {
    await appendNextAlbum();
  }
  nextIndex = Math.max(0, nextIndex);
  return playQueueIndex(nextIndex);
}

function queueAtNaturalEnd(raw, runtime, item) {
  const duration = Math.max(Number(raw.totlen) || 0, item.durationMs || 0);
  return String(raw.status || "").toLowerCase() === "stop"
    && runtime.confirmed && duration > 0 && duration - runtime.maxPosition <= 7000;
}

async function observeQueuePlayback() {
  if (queueBusy || !queueRuntime || !["playing", "paused"].includes(queueStore.queue.state)) return;
  queueBusy = true;
  try {
    const raw = await getDevicePlayerStatus();
    if (queueRuntime.queueItemId !== queueStore.queue.items[queueStore.queue.index]?.queueItemId) return;
    const status = String(raw.status || "").toLowerCase();
    const position = Math.max(0, Number(raw.curpos) || 0);
    const item = queueStore.queue.items[queueStore.queue.index];
    if (["play", "playing"].includes(status)) {
      if (position > queueRuntime.lastPosition || playbackTitle(raw) === playbackTitle({ title: item.title })) queueRuntime.confirmed = true;
      queueRuntime.lastPosition = position;
      queueRuntime.maxPosition = Math.max(queueRuntime.maxPosition, position);
      queueRuntime.terminalSamples = 0;
      if (queueStore.queue.state !== "playing") {
        queueStore.queue.state = "playing";
        saveQueueStore();
      }
    } else if (status === "pause") {
      queueRuntime.terminalSamples = 0;
      if (queueStore.queue.state !== "paused") {
        queueStore.queue.state = "paused";
        saveQueueStore();
      }
    } else if (queueAtNaturalEnd(raw, queueRuntime, item)) {
      queueRuntime.terminalSamples += 1;
      if (queueRuntime.terminalSamples >= 2) {
        if (queueStore.queue.options.autoNext) await advanceQueue(1);
        else {
          queueStore.queue.state = "stopped";
          queueRuntime = null;
          saveQueueStore();
        }
      }
    }
  } finally {
    queueBusy = false;
  }
}

function queuePayload() {
  return { revision: queueStore.revision, ...queueStore.queue, playlists: queueStore.playlists };
}

function matchingQueueIndex(status, queue, playback) {
  if (!new Set(["10", "20", "21"]).has(String(status.mode))) return -1;
  if (playback?.queueItemId) {
    const ownedIndex = queue.items.findIndex((item) => item.queueItemId === playback.queueItemId);
    if (ownedIndex >= 0) return ownedIndex;
  }
  const title = playbackTitle(status);
  if (!title) return -1;
  const current = queue.items[queue.index];
  if (current && playbackTitle({ title: current.title }) === title) return queue.index;
  return queue.items.findIndex((item) => playbackTitle({ title: item.title }) === title);
}

async function reconcileQueueStatus(status) {
  const index = matchingQueueIndex(status, queueStore.queue, directPlayback);
  if (index < 0) return;
  const deviceState = String(status.status || "").toLowerCase();
  const item = queueStore.queue.items[index];
  if (deviceState === "stop" && directPlayback?.queueItemId === item.queueItemId && queueStore.queue.options.autoNext) {
    const position = Math.max(0, Number(status.curpos) || 0);
    if (queueAtNaturalEnd(status, { confirmed: true, maxPosition: position }, item) && !queueBusy) {
      queueBusy = true;
      try {
        queueStore.queue.index = index;
        await advanceQueue(1);
      } finally {
        queueBusy = false;
      }
    }
    return;
  }
  if (!["play", "playing", "pause"].includes(deviceState)) return;
  const state = deviceState === "pause" ? "paused" : "playing";
  const changed = queueStore.queue.index !== index || queueStore.queue.state !== state;
  queueStore.queue.index = index;
  queueStore.queue.state = state;
  if (!queueRuntime || queueRuntime.queueItemId !== item.queueItemId) {
    const position = Math.max(0, Number(status.curpos) || 0);
    queueRuntime = {
      queueItemId: item.queueItemId,
      confirmed: state === "playing",
      lastPosition: position,
      maxPosition: position,
      terminalSamples: 0,
      startedAt: Date.now(),
    };
  }
  if (changed) saveQueueStore();
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

function deviceReadAttempts(command) {
  return new Set(["getPlayerStatus", "getStatusEx"]).has(command) ? 4 : 1;
}

async function deviceCommand(command) {
  const attempts = deviceReadAttempts(command);
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    try {
      const url = `http://${config.deviceIp}/httpapi.asp?command=${encodeURIComponent(command)}`;
      const response = await fetch(url, {
        signal: controller.signal,
        headers: attempt ? { Connection: "close" } : undefined,
      });
      if (!response.ok) throw new Error(`Enheden svarede med HTTP ${response.status}`);
      const text = await response.text();
      try {
        return JSON.parse(text);
      } catch {
        return { result: text.trim() || "OK" };
      }
    } catch (error) {
      lastError = error;
      if (attempt + 1 < attempts) await new Promise((resolve) => setTimeout(resolve, [250, 600, 1200][attempt]));
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError;
}

function getDevicePlayerStatus() {
  if (!playerStatusRequest) {
    playerStatusRequest = deviceCommand("getPlayerStatus").finally(() => {
      playerStatusRequest = null;
    });
  }
  return playerStatusRequest;
}

async function api(request, response, pathname) {
  if (request.method === "GET" && pathname === "/api/spotify/login") {
    if (!config.spotifyClientId) return redirect(response, "/?spotifyErrorCode=CLIENT_ID_REQUIRED");
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
    if (params.get("error")) return redirect(response, `/?spotifyErrorCode=${params.get("error") === "access_denied" ? "ACCESS_DENIED" : "TOKEN_EXCHANGE_FAILED"}`);
    if (!spotifyAuthorization || params.get("state") !== spotifyAuthorization.state || Date.now() - spotifyAuthorization.createdAt > 600_000) {
      spotifyAuthorization = null;
      return redirect(response, "/?spotifyErrorCode=INVALID_STATE");
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
      return redirect(response, "/?spotifyErrorCode=TOKEN_EXCHANGE_FAILED");
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

  if (request.method === "GET" && pathname === "/api/tone") {
    const tone = await getDeviceTone();
    return tone
      ? sendJson(response, 200, tone)
      : sendJson(response, 409, { error: "Den valgte iEast-enhed kan ikke aflæse tonekontrol" });
  }

  if (request.method === "POST" && pathname === "/api/tone") {
    const body = await readJson(request);
    const command = toneCommand(body.action, body.value);
    if (!command) return sendJson(response, 400, { error: "Ugyldig toneindstilling" });
    return sendJson(response, 200, await setDeviceTone(command));
  }

  if (request.method === "GET" && pathname === "/api/queue") return sendJson(response, 200, queuePayload());

  if (request.method === "PUT" && pathname === "/api/queue/options") {
    const body = await readJson(request);
    for (const key of ["autoNext", "continueAlbums", "shuffle"]) {
      if (typeof body[key] === "boolean") queueStore.queue.options[key] = body[key];
    }
    saveQueueStore();
    return sendJson(response, 200, queuePayload());
  }

  if (request.method === "POST" && pathname === "/api/queue") {
    const body = await readJson(request);
    if (!Array.isArray(body.entries) || !body.entries.length) return sendJson(response, 400, { error: "Vælg mindst ét nummer eller album" });
    const shuffle = typeof body.shuffle === "boolean" ? body.shuffle : queueStore.queue.options.shuffle;
    let tracks = await resolveQueueEntries(body.entries, shuffle);
    if (!tracks.length) return sendJson(response, 409, { error: "Valget indeholder ingen afspillelige numre" });
    if (body.startObjectId) {
      const startIndex = tracks.findIndex((track) => track.objectId === body.startObjectId);
      if (startIndex > 0) tracks = shuffle
        ? [tracks[startIndex], ...tracks.slice(0, startIndex), ...tracks.slice(startIndex + 1)]
        : tracks.slice(startIndex);
    }
    if (body.mode === "append") {
      queueStore.queue.items.push(...tracks);
      if (queueStore.queue.originalItems) queueStore.queue.originalItems.push(...tracks);
    }
    else {
      queueStore.queue = { ...emptyQueue(), options: { ...queueStore.queue.options, shuffle }, items: tracks };
      queueRuntime = null;
    }
    saveQueueStore();
    if (body.play !== false && body.mode !== "append") await playQueueIndex(0);
    return sendJson(response, 200, queuePayload());
  }

  if (request.method === "DELETE" && pathname === "/api/queue") {
    queueStore.queue = emptyQueue();
    queueRuntime = null;
    saveQueueStore();
    return sendJson(response, 200, queuePayload());
  }

  if (request.method === "POST" && pathname === "/api/queue/shuffle") {
    if (queueStore.queue.items.length < 2) return sendJson(response, 200, queuePayload());
    const currentId = queueStore.queue.items[queueStore.queue.index]?.queueItemId;
    if (!queueStore.queue.originalItems) queueStore.queue.originalItems = [...queueStore.queue.items];
    queueStore.queue.items = shuffledQueue(queueStore.queue.items);
    queueStore.queue.index = currentId ? queueStore.queue.items.findIndex((item) => item.queueItemId === currentId) : -1;
    saveQueueStore();
    return sendJson(response, 200, queuePayload());
  }

  if (request.method === "POST" && pathname === "/api/queue/reset") {
    if (!queueStore.queue.originalItems) return sendJson(response, 200, queuePayload());
    const currentId = queueStore.queue.items[queueStore.queue.index]?.queueItemId;
    queueStore.queue.items = queueStore.queue.originalItems;
    queueStore.queue.originalItems = null;
    queueStore.queue.index = currentId ? queueStore.queue.items.findIndex((item) => item.queueItemId === currentId) : -1;
    saveQueueStore();
    return sendJson(response, 200, queuePayload());
  }

  if (request.method === "POST" && pathname === "/api/queue/play-index") {
    const body = await readJson(request);
    if (!Number.isInteger(body.index) || body.index < 0 || body.index >= queueStore.queue.items.length) {
      return sendJson(response, 400, { error: "Ugyldigt nummer i køen" });
    }
    await playQueueIndex(body.index);
    return sendJson(response, 200, queuePayload());
  }

  if (request.method === "POST" && pathname === "/api/playlists") {
    const body = await readJson(request);
    const name = String(body.name || "").trim().slice(0, 100);
    if (!name) return sendJson(response, 400, { error: "Afspilningslisten skal have et navn" });
    const entries = Array.isArray(body.entries) && body.entries.length
      ? body.entries.slice(0, 2000)
      : queueStore.queue.items.map((track) => ({ type: "track", serverId: track.serverId, track }));
    if (!entries.length) return sendJson(response, 400, { error: "Afspilningslisten er tom" });
    const tracks = await resolveQueueEntries(entries, false);
    if (!tracks.length) return sendJson(response, 409, { error: "Afspilningslisten indeholder ingen afspillelige numre" });
    queueStore.playlists.push({ id: crypto.randomUUID(), name, entries, createdAt: Date.now() });
    queueStore.queue = { ...emptyQueue(), items: tracks, options: { ...queueStore.queue.options } };
    queueRuntime = null;
    saveQueueStore();
    return sendJson(response, 201, queuePayload());
  }

  const playlistMatch = pathname.match(/^\/api\/playlists\/([0-9a-f-]+)(?:\/(play))?$/i);
  if (playlistMatch && request.method === "PUT" && !playlistMatch[2]) {
    const playlist = queueStore.playlists.find((item) => item.id === playlistMatch[1]);
    if (!playlist) return sendJson(response, 404, { error: "Afspilningslisten findes ikke" });
    const body = await readJson(request);
    const entries = Array.isArray(body.entries) && body.entries.length
      ? body.entries.slice(0, 2000)
      : queueStore.queue.items.map((track) => ({ type: "track", serverId: track.serverId, track }));
    if (!entries.length) return sendJson(response, 400, { error: "Afspilningslisten er tom" });
    const tracks = await resolveQueueEntries(entries, false);
    if (!tracks.length) return sendJson(response, 409, { error: "Afspilningslisten indeholder ingen afspillelige numre" });
    playlist.entries = entries;
    if (String(body.name || "").trim()) playlist.name = String(body.name).trim().slice(0, 100);
    playlist.updatedAt = Date.now();
    queueStore.queue = { ...emptyQueue(), items: tracks, options: { ...queueStore.queue.options } };
    queueRuntime = null;
    saveQueueStore();
    return sendJson(response, 200, queuePayload());
  }
  if (playlistMatch && request.method === "DELETE" && !playlistMatch[2]) {
    queueStore.playlists = queueStore.playlists.filter((playlist) => playlist.id !== playlistMatch[1]);
    saveQueueStore();
    return sendJson(response, 200, queuePayload());
  }
  if (playlistMatch && request.method === "POST" && playlistMatch[2] === "play") {
    const playlist = queueStore.playlists.find((item) => item.id === playlistMatch[1]);
    if (!playlist) return sendJson(response, 404, { error: "Afspilningslisten findes ikke" });
    const body = await readJson(request);
    let tracks = await resolveQueueEntries(playlist.entries, false);
    if (body.shuffle === true) tracks = shuffled(tracks);
    if (!tracks.length) return sendJson(response, 409, { error: "Afspilningslisten indeholder ingen afspillelige numre" });
    queueStore.queue = { ...emptyQueue(), name: playlist.name, items: tracks, options: { ...queueStore.queue.options, shuffle: body.shuffle === true } };
    saveQueueStore();
    await playQueueIndex(0);
    return sendJson(response, 200, queuePayload());
  }

  if (request.method === "GET" && pathname === "/api/status") {
    const status = await getDevicePlayerStatus();
    await reconcileQueueStatus(status);
    if (!streamerName && spotifyTokens) {
      try {
        streamerName = (await deviceCommand("getStatusEx")).DeviceName || "";
      } catch {
        // LinkPlay status remains available when extended device details fail.
      }
    }
    const spotifyStatus = await getSpotifyPlayerStatus(streamerName, status);
    if (spotifyStatus) {
      saveDirectPlayback(null);
      return sendJson(response, 200, { ...status, ...spotifyStatus });
    }
    if (directPlayback && !directPlaybackMatches(status, directPlayback)) saveDirectPlayback(null);
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
    if (body.action === "next" && queueStore.queue.items.length) {
      return sendJson(response, 200, { item: await advanceQueue(1), queue: queuePayload() });
    }
    if (body.action === "prev" && queueStore.queue.items.length) {
      return sendJson(response, 200, { item: await playQueueIndex(Math.max(0, queueStore.queue.index - 1)), queue: queuePayload() });
    }
    if (body.action === "play" && queueStore.queue.items.length && queueStore.queue.state === "stopped") {
      return sendJson(response, 200, { item: await playQueueIndex(Math.max(0, queueStore.queue.index)), queue: queuePayload() });
    }
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
    if (body.action === "stop") {
      queueStore.queue.state = "stopped";
      queueRuntime = null;
      saveQueueStore();
    }
    const result = await deviceCommand(command);
    if (queueStore.queue.items.length && body.action === "pause") {
      queueStore.queue.state = "paused";
      saveQueueStore();
    } else if (queueStore.queue.items.length && body.action === "play") {
      queueStore.queue.state = "playing";
      saveQueueStore();
    }
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
    const metadata = body.metadata;
    queueStore.queue.state = "stopped";
    queueRuntime = null;
    saveQueueStore();
    const deviceStatusAtStart = metadata?.title
      ? await getDevicePlayerStatus().catch(() => null)
      : null;
    const result = await deviceCommand(`setPlayerCmd:play:${streamUrl.href}`);
    saveDirectPlayback(metadata?.title ? {
      Title: String(metadata.title).slice(0, 300),
      Artist: String(metadata.artist || "").slice(0, 200),
      Album: String(metadata.album || "").slice(0, 300),
      artwork: typeof metadata.artwork === "string" ? metadata.artwork : null,
      disableArtwork: metadata.disableArtwork === true,
      mediaType: metadata.mediaType === "radio" ? "radio" : "track",
      serverId: String(metadata.serverId || "").slice(0, 100),
      parentId: String(metadata.parentId || "").slice(0, 500),
      folderTitle: String(metadata.folderTitle || "").slice(0, 300),
      deviceStatusAtStart,
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
    const unavailable = error.name === "AbortError" || error.code || error.cause?.code;
    sendJson(response, unavailable ? 503 : 500, {
      error: unavailable ? `Kan ikke få kontakt til den valgte enhed eller server` : error.message,
      errorCode: unavailable ? "CONNECTION_UNAVAILABLE" : errorCodeFor(error.message),
    });
  }
});

function scheduleQueuePoll() {
  queuePollTimer = setTimeout(async () => {
    try {
      await observeQueuePlayback();
    } catch {
      // Temporary device errors must not discard or advance the queue.
    }
    if (queuePollTimer) scheduleQueuePoll();
  }, 2000);
  queuePollTimer.unref();
}

function startServer() {
  if (server.listening) return Promise.resolve(server.address());
  return new Promise((resolve, reject) => {
    const onError = (error) => reject(error);
    server.once("error", onError);
    server.listen(PORT, HOST, () => {
      server.off("error", onError);
      scheduleQueuePoll();
      resolve(server.address());
    });
  });
}

function stopServer() {
  if (queuePollTimer) clearTimeout(queuePollTimer);
  queuePollTimer = null;
  if (!server.listening) return Promise.resolve();
  return new Promise((resolve) => {
    server.close(resolve);
    server.closeAllConnections?.();
  });
}

if (require.main === module) {
  startServer().then(() => {
    console.log(`iEast Controller: http://localhost:${PORT}`);
    console.log(`Streamer: http://${config.deviceIp}`);
  });
}

module.exports = { currentPlayerStatus, deviceReadAttempts, durationMilliseconds, matchingQueueIndex, mcuFrame, normalizeConfig, parseMediaResponse, queueAtNaturalEnd, queueTrack, shuffledQueue, spotifyPlayerStatus, spotifySearchResults, startServer, stopServer, toneCommand, toneFromDevice, unknownDirectPlaybackStatus, server };
