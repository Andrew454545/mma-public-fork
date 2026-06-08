//! Before-paint CSS injection for cross-origin plugin iframes.
//!
//! Plugin iframes (e.g. Vali) live on a different origin, so parent CSS/JS can't reach
//! in. We inject natively via `js_init_script_on_all_frames`, which runs in the iframe's
//! own document context BEFORE first paint -- a JS/`postMessage` handshake would land too
//! late and flash the page's original colors.
//!
//! To add a themed iframe, add a `Theme` row to `THEMES`. The CSS must apply before paint,
//! so it lives here in the native layer rather than next to the plugin's TS.

use std::collections::BTreeMap;
use tauri::plugin::{Builder, TauriPlugin};
use tauri::Runtime;

struct Theme {
    /// Matched against `location.origin` inside the iframe.
    origin: &'static str,
    css: &'static str,
}

/// The registry. One row per core plugin that themes its iframe.
const THEMES: &[Theme] = &[Theme {
    origin: "https://valig.vercel.app",
    css: VALI_CSS,
}];

// Vali is shadcn/Tailwind: warm its blue-gray HSL surface vars to the app hue
// (--sand 60deg/6%), preserving each var's lightness offset from the page so elevation
// reads the same. Also override html,body bg directly -- valig hardcodes it as an inline
// LITERAL (its own anti-FOUC), not via the var, so remapping vars alone leaves it flashing.
const VALI_CSS: &str = concat!(
    ":root{",
    "--background:60 6% 14%!important;--card:60 6% 14%!important;--popover:60 6% 14%!important;",
    "--secondary:60 6% 21%!important;--muted:60 6% 21%!important;",
    "--accent:60 6% 27%!important;--border:60 6% 27%!important;--input:60 6% 27%!important;",
    "}",
    "html,body{background-color:hsl(60 6% 14%)!important;}"
);

// Generic bootstrap: looks up the current origin in the baked-in table and inserts the
// matching <style> into <html> the instant it exists (documentElement is null at
// document-start; a <style> is valid as a direct child of <html> before <head>).
const BOOTSTRAP: &str = r#"
(function () {
  var THEMES = __THEMES__;
  var css = THEMES[location.origin];
  if (!css) return;
  function inject() {
    var root = document.documentElement || document.head;
    if (!root) return false;
    var el = document.getElementById("__mma_iframe_theme");
    if (!el) {
      el = document.createElement("style");
      el.id = "__mma_iframe_theme";
      el.textContent = css;
    }
    if (el.parentNode !== root) root.appendChild(el);
    return true;
  }
  if (!inject()) {
    var obs = new MutationObserver(function () {
      if (inject()) obs.disconnect();
    });
    obs.observe(document, { childList: true, subtree: true });
  }
  document.addEventListener("DOMContentLoaded", inject);
})();
"#;

fn build_script() -> String {
    let map: BTreeMap<&str, &str> = THEMES.iter().map(|t| (t.origin, t.css)).collect();
    let json = serde_json::to_string(&map).expect("iframe theme table is serializable");
    BOOTSTRAP.replace("__THEMES__", &json)
}

pub fn plugin<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("iframe-theme")
        .js_init_script_on_all_frames(build_script())
        .build()
}
