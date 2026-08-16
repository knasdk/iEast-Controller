const assert = require("node:assert/strict");
const test = require("node:test");

const { currentPlayerStatus, durationMilliseconds, matchingQueueIndex, mcuFrame, parseMediaResponse, queueAtNaturalEnd, queueTrack, shuffledQueue, spotifyPlayerStatus, toneCommand, toneFromDevice, unknownDirectPlaybackStatus } = require("../server");

function soapResponse(didl) {
  const result = didl.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  return `<s:Envelope><s:Body><Result>${result}</Result><TotalMatches>2</TotalMatches></s:Body></s:Envelope>`;
}

test("parseMediaResponse resolves artwork for album containers", () => {
  const didl = `
    <DIDL-Lite>
      <container id="album-1" parentID="albums" childCount="12">
        <dc:title>Test Album</dc:title>
        <upnp:class>object.container.album.musicAlbum</upnp:class>
        <upnp:class>object.container.album.musicAlbum</upnp:class>
        <upnp:albumArtURI>/AlbumArt/album-1.jpg</upnp:albumArtURI>
      </container>
      <item id="track-1" parentID="album-1">
        <dc:title>Test Track</dc:title>
        <upnp:class>object.item.audioItem.musicTrack</upnp:class>
        <res duration="0:03:42.500">http://192.168.0.10:8200/MediaItems/track-1.mp3</res>
        <upnp:albumArtURI>http://192.168.0.10:8200/AlbumArt/album-1.jpg</upnp:albumArtURI>
      </item>
    </DIDL-Lite>`;

  const result = parseMediaResponse(soapResponse(didl), "http://192.168.0.10:8200");

  assert.equal(result.containers[0].artwork, "http://192.168.0.10:8200/AlbumArt/album-1.jpg");
  assert.equal(result.containers[0].parentId, "albums");
  assert.equal(result.containers[0].mediaClass, "object.container.album.musicAlbum");
  assert.equal(result.items[0].artwork, "http://192.168.0.10:8200/AlbumArt/album-1.jpg");
  assert.equal(result.items[0].id, "track-1");
  assert.equal(result.items[0].parentId, "album-1");
  assert.equal(result.items[0].durationMs, 222500);
});

test("durationMilliseconds parses UPnP durations", () => {
  assert.equal(durationMilliseconds("1:02:03.250"), 3723250);
  assert.equal(durationMilliseconds("unknown"), 0);
});

test("queueTrack validates and preserves playable DLNA metadata", () => {
  const track = queueTrack({ id: "track-1", parentId: "album-1", url: "http://music/track.mp3", title: "Track", duration: "0:03:00" }, "music");
  assert.equal(track.objectId, "track-1");
  assert.equal(track.durationMs, 180000);
  assert.equal(queueTrack({ url: "file:///tmp/track.mp3" }, "music"), null);
});

test("queueAtNaturalEnd only accepts confirmed playback near the track end", () => {
  const item = { durationMs: 180000 };
  assert.equal(queueAtNaturalEnd({ status: "stop", totlen: 180000 }, { confirmed: true, maxPosition: 176000 }, item), true);
  assert.equal(queueAtNaturalEnd({ status: "pause", totlen: 180000 }, { confirmed: true, maxPosition: 176000 }, item), false);
  assert.equal(queueAtNaturalEnd({ status: "stop", totlen: 180000 }, { confirmed: false, maxPosition: 176000 }, item), false);
  assert.equal(queueAtNaturalEnd({ status: "stop", totlen: 180000 }, { confirmed: true, maxPosition: 120000 }, item), false);
});

test("matchingQueueIndex restores the current direct track after restart", () => {
  const queue = {
    index: 0,
    items: [{ title: "First track" }, { title: "Georgia on My Mind" }, { title: "Last track" }],
  };
  const status = { mode: "10", status: "play", Title: Buffer.from("Georgia on My Mind").toString("hex") };
  assert.equal(matchingQueueIndex(status, queue), 1);
  assert.equal(matchingQueueIndex({ ...status, mode: "31" }, queue), -1);
});

test("shuffledQueue changes a queue with multiple items without losing entries", () => {
  const items = Array.from({ length: 8 }, (_, index) => ({ id: index + 1, album: `Album ${Math.floor(index / 2) + 1}` }));
  const result = shuffledQueue(items);
  assert.notDeepEqual(result, items);
  assert.deepEqual(result.map((item) => item.id).sort(), items.map((item) => item.id));
  assert.equal(result.some((item, index) => item === items[index]), false);
  assert.equal(result.some((item, index) => index && item.album === result[index - 1].album), false);
});

test("shuffledQueue spreads an unavoidable album majority across the queue", () => {
  const items = [
    ...Array.from({ length: 17 }, (_, index) => ({ id: `ray-${index}`, album: "Ray" })),
    ...Array.from({ length: 11 }, (_, index) => ({ id: `elton-${index}`, album: "Elton" })),
  ];
  const result = shuffledQueue(items);
  let longestRun = 1;
  let currentRun = 1;
  for (let index = 1; index < result.length; index += 1) {
    currentRun = result[index].album === result[index - 1].album ? currentRun + 1 : 1;
    longestRun = Math.max(longestRun, currentRun);
  }
  assert.equal(longestRun, 2);
});

test("parseMediaResponse rejects non-HTTP artwork URLs", () => {
  const didl = `
    <DIDL-Lite>
      <container id="folder-1">
        <dc:title>Folder</dc:title>
        <upnp:albumArtURI>data:image/png;base64,unsafe</upnp:albumArtURI>
      </container>
    </DIDL-Lite>`;

  const result = parseMediaResponse(soapResponse(didl), "http://192.168.0.10:8200");

  assert.equal(result.containers[0].artwork, null);
});

test("currentPlayerStatus keeps local metadata and navigation context while the device reports its startup state", () => {
  const status = { mode: "10", status: "play", Title: "Current track", Artist: "Current artist" };
  const playback = {
    Title: "Previous track",
    Artist: "Previous artist",
    serverId: "music",
    parentId: "album-1",
    folderTitle: "Previous album",
    deviceStatusAtStart: status,
    startedAt: 1000,
  };

  assert.deepEqual(currentPlayerStatus(status, playback, 7000), {
    ...status,
    Title: "Previous track",
    Artist: "Previous artist",
    serverId: "music",
    parentId: "album-1",
    folderTitle: "Previous album",
  });
});

test("currentPlayerStatus stops applying stale metadata after an external source change", () => {
  const playback = {
    Title: "Previous track",
    Artist: "Previous artist",
    deviceStatusAtStart: { Title: "Track before playback", Artist: "Another artist" },
    startedAt: 1000,
  };
  const status = { mode: "10", status: "play", Title: "Current track", Artist: "Current artist" };

  assert.equal(currentPlayerStatus(status, playback, 7000), status);
});

test("currentPlayerStatus keeps navigation context when only the reported artist differs", () => {
  const playback = { Title: "Current track", Artist: "Album artist", serverId: "music", parentId: "folder", startedAt: 1000 };
  const status = { mode: "10", status: "play", Title: "Current track", Artist: "Track artist" };

  assert.deepEqual(currentPlayerStatus(status, playback, 7000), {
    ...status,
    Title: "Current track",
    Artist: "Album artist",
    serverId: "music",
    parentId: "folder",
  });
});

test("currentPlayerStatus supplies local metadata immediately", () => {
  const playback = { Title: "New track", Artist: "New artist", startedAt: 1000 };
  const status = { mode: "10", status: "play", Title: "Previous track", Artist: "Previous artist" };

  assert.deepEqual(currentPlayerStatus(status, playback, 2000), {
    ...status,
    Title: "New track",
    Artist: "New artist",
  });
});

test("spotifyPlayerStatus uses the current track on the iEast device", () => {
  const playback = {
    is_playing: true,
    progress_ms: 12000,
    device: { name: "Musik å æ slot" },
    item: {
      type: "track",
      uri: "spotify:track:123",
      name: "Georgia",
      duration_ms: 240000,
      artists: [{ name: "Elton John" }],
      album: { name: "Elton John", images: [{ url: "https://example.com/cover.jpg" }] },
    },
  };

  assert.deepEqual(spotifyPlayerStatus(playback, "Musik å æ slot"), {
    status: "play",
    curpos: 12000,
    totlen: 240000,
    Title: "Georgia",
    Artist: "Elton John",
    Album: "Elton John",
    albumUri: null,
    artwork: "https://example.com/cover.jpg",
    spotifyUri: "spotify:track:123",
    mediaType: "track",
  });
});

test("spotifyPlayerStatus ignores playback on another device", () => {
  const playback = {
    is_playing: true,
    device: { name: "Telefon" },
    item: { type: "track", name: "Georgia" },
  };

  assert.equal(spotifyPlayerStatus(playback, "Musik å æ slot"), null);
});

test("spotifyPlayerStatus ignores a paused Spotify session while another source plays", () => {
  const playback = {
    is_playing: false,
    device: { name: "Musik å æ slot" },
    item: { type: "track", name: "Old track", artists: [], album: { images: [] } },
  };

  assert.equal(spotifyPlayerStatus(playback, "Musik å æ slot", { status: "play" }), null);
});

test("unknownDirectPlaybackStatus uses metadata reported by the device", () => {
  const status = { mode: "10", status: "play", Title: "Current track", Artist: "Current artist", totlen: "0" };

  assert.deepEqual(unknownDirectPlaybackStatus(status, false), {
    ...status,
    mediaType: "radio",
  });
  assert.equal(unknownDirectPlaybackStatus(status, true), status);
});

test("toneCommand creates validated iEast tone commands", () => {
  assert.equal(toneCommand("bass", 2), "MCU+PAS+209&");
  assert.equal(toneCommand("treble", 4), "MCU+PAS+110&");
  assert.equal(toneCommand("bass", -12), "MCU+PAS+201&");
  assert.equal(toneCommand("treble", 12), "MCU+PAS+114&");
  assert.equal(toneCommand("midrange", 0), null);
  assert.equal(toneCommand("bass", 13), null);
  assert.equal(toneCommand("treble", 3), null);
});

test("toneFromDevice decodes the MCU values used by iEAST-01", () => {
  assert.deepEqual(toneFromDevice(["MCU+PAS+110&", "MCU+PAS+209&"]), { bass: 2, treble: 4 });
  assert.deepEqual(toneFromDevice("MCU+PAS+101&MCU+PAS+214&"), { bass: 12, treble: -12 });
  assert.equal(toneFromDevice("MCU+PAS+110&"), null);
});

test("mcuFrame creates the LinkPlay UART packet header", () => {
  const frame = mcuFrame("MCU+PAS+EQGet&");
  assert.equal(frame.readUInt32LE(0), 538482200);
  assert.equal(frame.readUInt32LE(4), 14);
  assert.equal(frame.readUInt32LE(8), 0);
  assert.equal(frame.subarray(20).toString(), "MCU+PAS+EQGet&");
});
