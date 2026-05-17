# MMA Plugins

Plugins extend MMA with custom functionality: new tools, integrations with external scripts, custom UI panels, and more.

## Plugin directory

User plugins live in your app data folder:

```
Windows:  %LOCALAPPDATA%/app.map-making.local/plugins/<plugin-id>/
Linux:    ~/.local/share/app.map-making.local/plugins/<plugin-id>/
macOS:    ~/Library/Application Support/app.map-making.local/plugins/<plugin-id>/
```

Each plugin is a folder containing at minimum:
- `manifest.json` — metadata and entry point
- `index.js` (or whatever `main` points to) — the plugin code

## manifest.json

The manifest is the plugin's identity:

```json
{
  "id": "my-plugin",
  "name": "My Plugin",
  "description": "What it does",
  "icon": "M20.5,11H19V7...",
  "version": "1.0.0",
  "main": "index.js"
}
```

- `id` — unique identifier (kebab-case recommended, defaults to folder name)
- `name` — display name shown in the plugin marketplace
- `description` — short description (optional)
- `icon` — MDI SVG path string (get one from [pictogrammers.com/library/mdi](https://pictogrammers.com/library/mdi/), or `npm install -D @mdi/js` and import the constant)
- `main` — entry point JS file, loaded as an ES module (defaults to `index.js`)

## Writing a plugin

Your entry point is an ES module that calls `MMA.registerPlugin()`:

```js
MMA.registerPlugin({
  activate() {
    // Called when the plugin activates (map opens + plugin enabled)
    // Use MMA.* to interact with the editor
    return () => {
      // Optional cleanup — called on deactivate
    };
  },
});
```

## The MMA API

The global `MMA` object is the single API surface. It provides:

- Map & location CRUD
- Tag management
- Selection queries
- Event subscription
- Shell command spawning
- File dialogs
- Raw Tauri IPC for advanced use

**The definitive API reference is the typed source at `app/src/plugins/index.ts`.** Every method on `MMA` is defined there with full TypeScript types. When in doubt, read that file — it's always up to date.

### Quick reference (categories)

**Locations:** `getMap()`, `getActiveLocation()`, `addLocations(locs)`, `removeLocations(ids)`, `updateLocation(id, patch)`, `setActiveLocation(id)`, `getLocationsByIds(ids)`, `createLocation(partial)`

**Tags:** `addTag(tag)`, `updateTag(id, patch)`

**Selections:** `getSelections()`, `getSelectedLocationIds()`, `queryIds(selectionProps)`

**Events:** `on(event, handler)` — returns an unsubscribe function. Events: `location:add`, `location:remove`, `location:update`, `selection:change`, `map:open`, `map:close`

**Shell:** `shell.Command` — spawn subprocesses. See [Tauri shell plugin docs](https://v2.tauri.app/plugin/shell/).

**Dialogs:** `dialog.open(opts)`, `dialog.save(opts)` — native file picker.

**IPC:** `invoke(command, args)` — call any Tauri backend command directly.

**Plugin UI:** `enterPluginMode(id)`, `exitPluginMode()`, `getGoogleMap()`

## UI plugins

Plugins can provide React components for richer UI:

```js
MMA.registerPlugin({
  activate() {},
  sidebar: MySidebarComponent,    // shown in sidebar when user clicks plugin icon
  modal: MyModalComponent,        // shown as a dialog
  locationPanel: MyPanelComponent, // shown below location preview
});
```

Component props:
- `sidebar` receives `{ onClose: () => void }`
- `modal` receives `{ onClose: () => void }`
- `locationPanel` receives no props

Since external plugins are plain JS (not compiled with the app), UI plugins need to **bundle React** into their output. Use esbuild, rollup, or Vite in library mode. Your bundler config should mark nothing as external — bundle everything.

Example esbuild config:

```js
require("esbuild").build({
  entryPoints: ["src/index.tsx"],
  bundle: true,
  format: "esm",
  outfile: "dist/index.js",
  // Bundle React into the plugin — the app doesn't expose it globally
  external: [],
});
```

## Distribution

Plugins are distributed as folders. To install a plugin:

1. Copy the plugin folder into your plugins directory
2. Restart MMA (or close/reopen a map)
3. Enable the plugin in the plugin marketplace (sidebar gear icon)

To share a plugin: zip the folder and distribute it however you like (GitHub releases, Discord, etc.).

## TypeScript support

Install the MMA type declarations for autocomplete and type checking:

```
npm install -D github:ccmdi/map-making-app#main&path=plugins/types
```

Then add to your `tsconfig.json`:

```json
{
  "include": ["src", "node_modules/mma-plugin-types/mma.d.ts"]
}
```

### Optional type dependencies

Depending on what your plugin uses, you may need additional type packages:

| You use | Install |
|---|---|
| `icon` field (MDI icons) | `npm install -D @mdi/js` — or just copy the SVG path string from [pictogrammers.com/library/mdi](https://pictogrammers.com/library/mdi/) |
| `MMA.getGoogleMap()` | `npm install -D @types/google.maps` |
| UI components (`sidebar`, `modal`, `locationPanel`) | `npm install -D react @types/react` |
| `MMA.shell.Command` / `MMA.dialog.*` | Types are included in `mma-plugin-types` — no extra install needed |

## Development tips

- Use `console.log` in your plugin — output appears in browser devtools (F12 in the Tauri window)
- The plugin reloads when you close and reopen a map
- For rapid iteration, symlink your dev folder into the plugins directory
- The source of truth for the MMA API is `app/src/plugins/index.ts` — the type declarations are generated from it

## Sample plugin

See the `sample/` folder in this directory for a working example demonstrating all the patterns above.
