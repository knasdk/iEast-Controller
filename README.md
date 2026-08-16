# iEast Controller

A lightweight web controller for iEast and other LinkPlay-based audio streamers. It provides one browser interface for playback controls, internet radio, local DLNA music libraries, and Spotify Connect.

The application has a dependency-free Node.js server with a responsive frontend. It is intended to run on the same private network as the streamer and any DLNA servers.

## Features

- Control playback, volume, mute, bass, treble, seeking, and track navigation
- Display current track metadata and artwork
- Search and browse one or more DLNA/UPnP media servers
- Play complete albums sequentially or shuffled, with optional continuation to the next album folder
- Build a persistent queue and save named playlists containing individual tracks or complete albums
- Play and manage internet radio stations
- Rate and sort radio stations
- Search Spotify for tracks, albums, artists, and playlists
- Browse Spotify albums and send playback to a Spotify Connect device
- Configure private deployment values through environment variables
- Run the web server without a database or runtime npm dependencies

## Requirements

- Node.js 18 or newer
- An iEast or compatible LinkPlay streamer reachable from the server
- Optional: a DLNA/UPnP media server such as MiniDLNA
- Optional: a Spotify Premium account and Spotify Developer app

Prebuilt desktop packages include their own runtime and do not require Node.js or a separate browser.

## Desktop Packages

Tagged releases produce three standalone downloads:

- `iEast-Controller-<version>-x86_64.AppImage` for 64-bit Linux
- `iEast-Controller-Setup-<version>-x64.exe` as a Windows installer
- `iEast-Controller-Portable-<version>-x64.exe` as a Windows executable without installation

Download them from the repository's GitHub Releases page. The binaries start the local controller server, display the interface in their own window, and stop the server when the window closes.

On Linux, make the AppImage executable before starting it:

```bash
chmod +x iEast-Controller-*.AppImage
./iEast-Controller-*.AppImage
```

On Windows, start either the setup program or the portable executable. Unsigned development releases may display a Windows SmartScreen warning.

Open **Indstillinger** on first launch and enter the iEast IP address. DLNA servers and an optional Spotify Client ID can be configured in the same dialog. Desktop settings, queues, playlists, and Spotify tokens are stored under `~/.config/ieast-controller/state` on Linux and `%APPDATA%\ieast-controller\state` on Windows.

Spotify must have this exact redirect URI registered in its Developer Dashboard:

```text
http://127.0.0.1:3000/api/spotify/callback
```

Port 3000 must be available while the desktop app runs. `IEAST_PORT` can override it, but the matching redirect URI must then also be registered with Spotify.

### Building the packages

Install the development dependencies, run the tests, and build for the current platform:

```bash
npm ci
npm test
npm run dist:linux
```

Use `npm run dist:win` on Windows. GitHub Actions builds both platforms on native runners whenever a `v*` tag is pushed; tagged builds are published automatically as a GitHub Release with SHA-256 checksums.

## Quick Start

1. Clone or download the repository.
2. Enter the project directory.
3. Create your private environment file:

```bash
cp .env.example .env
```

4. Edit `.env` with your streamer and media server details.
5. Start the application:

```bash
npm start
```

6. Open <http://localhost:3000> in a browser.

No `npm install` step is required because the project only uses built-in Node.js modules.

## KDE Neon App

The project includes a lightweight KDE launcher that runs the server locally and opens it in a dedicated Chromium or Google Chrome app window. This keeps the controller on the private network and uses Spotify's supported loopback callback.

### 1. Install requirements

The KDE Neon computer needs:

- Node.js 18 or newer
- Chromium or Google Chrome
- `curl`
- Network access to the iEast streamer and any configured media servers

Check the installed versions:

```bash
node --version
curl --version
chromium --version
```

`chromium-browser`, Flatpak Brave, `google-chrome`, and `google-chrome-stable` are also detected automatically. Chromium is preferred, followed by Flatpak Brave; Google Chrome is used as a fallback.

### 2. Download and configure the project

Clone the repository and enter it:

```bash
git clone https://github.com/knasdk/iEast-Controller.git
cd iEast-Controller
```

Create the local configuration:

```bash
cp .env.example .env
```

At minimum, set the streamer's address in `.env`. Add the Spotify Client ID when Spotify support is needed:

```dotenv
IEAST_IP=192.168.0.45
SPOTIFY_CLIENT_ID=your_client_id
```

The KDE launcher supplies its own local values for `HOST`, `PORT`, `STATE_DIR`, and `SPOTIFY_REDIRECT_URI`, so those values do not need to be changed for desktop use.

### 3. Configure Spotify

Add this exact redirect URI to the Spotify Developer Dashboard:

```text
http://127.0.0.1:3000/api/spotify/callback
```

Spotify permits plain HTTP for this address because `127.0.0.1` is a loopback address. The Client ID in `.env` must belong to the same Spotify Developer app.

### 4. Install the KDE launcher

Make the scripts executable if the project was downloaded as an archive:

```bash
chmod +x scripts/install-kde.sh scripts/launch-kde.sh
```

Install the launcher for the current Linux user:

```bash
./scripts/install-kde.sh
```

Open **iEast Controller** from the KDE application menu. It may be necessary to log out and back in if KDE does not refresh the menu immediately.

The launcher starts a server bound only to `127.0.0.1`, opens a dedicated browser window, and stops the server when the window closes. Runtime data is stored in `~/.local/state/ieast-controller`, and browser data is stored in `~/.config/ieast-controller`.

Port 3000 must be available. If a manually started development server is already using it, stop that terminal with `Ctrl+C` or run:

```bash
fuser -k 3000/tcp
```

### Updating

Close the KDE app, update the repository, and reinstall the menu entry if the project path has changed:

```bash
git pull --ff-only
./scripts/install-kde.sh
```

The `.env` file and all runtime settings are preserved during Git updates.

### Uninstalling

Remove the application menu entry with:

```bash
./scripts/install-kde.sh --uninstall
```

This does not delete `.env`, the repository, or the runtime data under `~/.local/state/ieast-controller`.

## Configuration

The web server loads `.env` from the project root. Real environment variables take precedence over values in that file. The iEast address, media servers, and Spotify Client ID provide initial values and can subsequently be changed under **Indstillinger**.

```dotenv
HOST=0.0.0.0
PORT=3000

IEAST_IP=192.168.1.100

MEDIA_SERVERS=[{"id":"music","name":"Music library","url":"http://192.168.1.101:8200"}]

SPOTIFY_CLIENT_ID=
SPOTIFY_REDIRECT_URI=

# Optional persistent volume; defaults to .state inside the project
# STATE_DIR=/var/lib/ieast-controller
```

| Variable | Required | Description |
| --- | --- | --- |
| `HOST` | No | Address the HTTP server listens on. Defaults to `0.0.0.0`. |
| `PORT` | No | HTTP port. Defaults to `3000`. |
| `IEAST_IP` | Yes | Local IPv4 address of the iEast/LinkPlay streamer. |
| `MEDIA_SERVERS` | No | JSON array of DLNA servers. Each entry requires `id`, `name`, and `url`. |
| `SPOTIFY_CLIENT_ID` | For Spotify | Client ID from the Spotify Developer Dashboard. |
| `SPOTIFY_REDIRECT_URI` | No | Fixed OAuth callback URL, normally used behind a reverse proxy. |
| `STATE_DIR` | No | Directory for settings, queues, playlists, and OAuth tokens. Defaults to `.state` in the project. |

Multiple DLNA servers can be configured in one line:

```dotenv
MEDIA_SERVERS=[{"id":"nas","name":"Home NAS","url":"http://192.168.1.101:8200"},{"id":"office","name":"Office library","url":"http://192.168.1.102:8200"}]
```

Saved values from **Indstillinger** take precedence over the corresponding `.env` defaults. Changing the Spotify Client ID disconnects the existing Spotify account because its tokens belong to the previous application.

## Spotify Setup

Spotify playback control requires Spotify Premium. This project uses OAuth with PKCE, so a Client Secret is not required.

1. Open the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard) and sign in.
2. Select **Create app**.
3. Enter an app name and description.
4. Add the redirect URI shown under **Settings → Spotify Client ID** in iEast Controller.
5. For local use, the URI is normally:

```text
http://127.0.0.1:3000/api/spotify/callback
```

6. Select **Web API**, accept Spotify's terms, and create the app.
7. Copy the app's **Client ID** into **Indstillinger → Spotify Client ID**. Alternatively, set `SPOTIFY_CLIENT_ID` in `.env` before the first start.
8. Open the Spotify tab and select **Connect Spotify**.

The redirect URI in Spotify must match exactly. Spotify permits plain HTTP for loopback IP addresses such as `127.0.0.1`, but deployed domains and non-loopback addresses should use HTTPS.

## State And Persistence

On first start, the web server automatically creates `.state/` in the project directory. It stores:

- Application settings and radio ratings in `.state/settings.json`
- Spotify OAuth tokens in `.state/spotify.json`
- Current direct-playback context in `.state/playback.json`
- The queue and named playlists in `.state/queue.json`

The entire `.state/` directory is excluded by `.gitignore`, so runtime data and tokens are never committed. To use a persistent volume on a deployed instance, point `STATE_DIR` at its mounted path:

```dotenv
STATE_DIR=/var/lib/ieast-controller
```

The server creates the directory and state files automatically with restrictive permissions. Do not remove `.state/` from `.gitignore` or copy its Spotify token into Git.

## Deployment

The server can run directly with `npm start` or behind a reverse proxy. When using a reverse proxy:

- Forward `X-Forwarded-Proto` and `X-Forwarded-Host`.
- Use HTTPS for the public URL.
- Set an explicit callback if proxy headers are unavailable:

```dotenv
SPOTIFY_REDIRECT_URI=https://music.example.com/api/spotify/callback
```

- Add exactly the same URL to the Spotify Developer Dashboard.
- On ephemeral hosting, mount a persistent directory and set `STATE_DIR` to that path.
- Ensure the deployed server can route to the streamer's and DLNA servers' private IP addresses.

> [!WARNING]
> iEast Controller does not include user authentication. Do not expose it directly to the public internet. Use a private network, VPN, or an authenticated reverse proxy.

## Using The Controller

- Use the player at the top for transport, seek, volume, mute, bass, and treble controls.
- Use **Search** to find music across the selected DLNA server.
- Use **Browse** to navigate the DLNA folder hierarchy.
- Use **Spotify** to connect an account, choose a Connect device, and search Spotify.
- Use the radio section to play, rate, and filter stations.
- Open the gear icon to configure the streamer, media servers, Spotify, and radio stations.

## Troubleshooting

### The streamer cannot be reached

- Confirm `IEAST_IP` is correct.
- Confirm the Node.js server and streamer can reach each other on the same network or VPN.
- Check that no firewall blocks access to the streamer.

### The DLNA library is empty or unavailable

- Confirm the URL in `MEDIA_SERVERS` is reachable from the Node.js server.
- MiniDLNA commonly uses port `8200`.
- Validate that `MEDIA_SERVERS` is valid JSON on a single line.

### Spotify reports a redirect URI error

- Copy the URI shown in the application's Spotify tutorial.
- Confirm the URI matches the Spotify Dashboard entry exactly, including protocol, hostname, port, and path.
- Use `127.0.0.1` instead of `localhost` for local Spotify setup.
- Use HTTPS when deploying on a hostname or non-loopback IP address.

### Spotify login disappears after deployment or restart

Confirm that `.state/` survives restarts. On ephemeral hosting, configure `STATE_DIR` to use a persistent volume.

### No Spotify Connect devices are shown

- Open Spotify on the target device or another Spotify client first.
- Confirm the device uses the same Spotify account.
- Confirm the account has Spotify Premium.

## Security

- `.env` is excluded by `.gitignore`.
- `.env.example` contains placeholders only and is safe to commit.
- Spotify uses PKCE and does not require a Client Secret.
- OAuth tokens are never sent to the browser.
- `.state/` is ignored, so the repository contains no OAuth tokens or runtime state.

Before committing, verify the file list:

```bash
git status --short
git check-ignore -v .env
```

## Project Structure

```text
.
├── .env.example       # Safe configuration template
├── public/
│   ├── app.js         # Browser application
│   ├── index.html     # User interface
│   └── styles.css     # Responsive styling
├── electron-main.js   # Cross-platform desktop shell
├── server.js          # HTTP API, LinkPlay, DLNA, and Spotify integration
├── package.json
└── README.md
```

## License

No license has been added yet. Add a license before distributing or accepting external contributions.
