// Sample MMA Plugin
// Demonstrates: registration, events, location access, extra fields.
// Copy this folder to your MMA plugins directory to install.

// Identity (id, name, description, icon) comes from manifest.json.
// This file only provides behavior.

MMA.registerPlugin({

  activate() {
    // --- Event subscription ---
    const unsub = MMA.on("location:add", (locations) => {
      console.log(`[sample] ${locations.length} location(s) added`);
    });

    // --- Reading map state ---
    const map = MMA.getMap();
    if (map) {
      console.log(`[sample] Map "${map.meta.name}" has ${Object.keys(map.meta.tags).length} tags`);
    }

    // --- Querying locations ---
    // Get all location IDs matching a selection filter
    // MMA.queryIds({ type: "Everything" }).then(ids => {
    //   console.log(`[sample] Map has ${ids.length} locations`);
    // });

    // --- Updating locations with extra fields ---
    // const loc = MMA.getActiveLocation();
    // if (loc) {
    //   MMA.updateLocation(loc.id, {
    //     extra: { ...loc.extra, myField: "hello from plugin" }
    //   });
    // }

    // --- File dialogs ---
    // MMA.dialog.open({ filters: [{ name: "JSON", extensions: ["json"] }] })
    //   .then(path => { if (path) console.log(`[sample] User picked: ${path}`); });

    // --- Raw Tauri IPC (for advanced use) ---
    // MMA.invoke("store_get_all_locations").then(locs => { ... });

    // Return cleanup function — called when plugin deactivates
    return () => {
      unsub();
      console.log("[sample] Plugin deactivated");
    };
  },
});
