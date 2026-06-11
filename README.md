# LevelHeaded

A Chrome extension that automatically evens out streaming audio: loud sound
effects and jump-scare stingers get firmly capped, quiet dialogue gets lifted.
No interaction needed — install it and press Play.

Works on any OS Chrome runs on (macOS, Linux, Windows) and on any site that
plays video (Netflix, YouTube, Disney+, Prime Video, …). Known music services
are disabled by default so your music keeps its dynamics.

## Install (no toolchain needed)

1. Download `levelheaded.zip` from the latest
   [release](../../releases) and unzip it (or grab the `levelheaded-unpacked`
   artifact from any CI run).
2. Open `chrome://extensions`, enable **Developer mode** (top right).
3. Click **Load unpacked** and select the unzipped folder.

The toolbar badge shows a green **ON** while a page's audio is being leveled.
Click the icon to toggle globally or per-site.

## Build from source

Requires Node 20 (`.nvmrc`).

```sh
npm ci
npm run build   # production build into dist/ — load that folder unpacked
npm run dev     # dev server with hot reload (load dist/ once, then iterate)
npm test        # unit tests
```

## How it works

A content script attaches a Web Audio processing chain to every playing
`<video>`/`<audio>` element whose media is same-origin (which includes all
MSE-based streamers). Currently (M1) the chain is a fast-attack compressor
plus makeup gain; M2 replaces it with a two-stage AGC + 15 ms lookahead
limiter that catches transients *before* they reach your ears. See
[DESIGN.md](DESIGN.md) for the full design and its trade-offs.

## License

[MIT](LICENSE)
