# MMA

Local-first desktop clone of [map-making.app](https://map-making.app).

## Features

- Offline/local-first
- Handles millions of locations
- Plugin system
- Configurable hotkeys
- Extra fields on locations - non-boolean arbitrary metadata
- Composable selections
- Map generator built-in
- Version history with commits

## Installation
### User
Open [the releases menu](https://github.com/ccmdi/mma/releases) and download the respective installation for your system.

### From source

```bash
cd app && npm install && cargo tauri build
```

Requires: Rust toolchain, Node.js, npm.

## Plugins

See [plugins/README.md](plugins/README.md).
