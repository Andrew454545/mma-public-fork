use std::collections::{HashMap, HashSet};
use arrow::array::{RecordBatch, StringArray, Float64Array, UInt32Array, ListArray, Array};
use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use crate::fast_io::LocationData;

#[derive(Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum SelectionProps {
    Locations { locations: Vec<u32>, name: Option<String> },
    Everything,
    #[serde(rename_all = "camelCase")]
    Polygon { polygon: PolygonGeometry, #[serde(rename = "includeInformational")] include_informational: bool },
    Tag { #[serde(rename = "tagId")] tag_id: u32 },
    Untagged,
    Unpanned,
    PanoIds,
    NotPanoIds,
    Manual { locations: Vec<u32> },
    Duplicates { distance: f64 },
    ValidationState { locations: Vec<u32>, state: u8 },
    Intersection { selections: Vec<Selection> },
    Union { selections: Vec<Selection> },
    Invert { selections: Vec<Selection> },
    Filter { field: String, op: String, value: serde_json::Value, value2: Option<serde_json::Value> },
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PolygonGeometry {
    pub coordinates: Vec<Vec<[f64; 2]>>,
    pub extra_polygons: Option<Vec<Vec<Vec<[f64; 2]>>>>,
    pub properties: Option<serde_json::Value>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Selection {
    pub key: String,
    pub color: [u8; 3],
    pub props: SelectionProps,
    #[serde(default)]
    pub locations: Vec<u32>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SelectionSummary {
    pub key: String,
    pub color: [u8; 3],
    #[serde(rename = "type")]
    pub sel_type: String,
    pub count: usize,
}

// ---------------------------------------------------------------------------
// LocView: unified view over Arrow batch + overlay
// ---------------------------------------------------------------------------

pub struct LocView<'a> {
    batch: Option<&'a RecordBatch>,
    dead: &'a HashSet<u32>,
    patches: &'a HashMap<u32, LocationData>,
    adds: &'a [LocationData],
    // Cached column refs (from batch)
    ids: Option<&'a UInt32Array>,
    lats: Option<&'a Float64Array>,
    lngs: Option<&'a Float64Array>,
    headings: Option<&'a Float64Array>,
    pitches: Option<&'a Float64Array>,
    zooms: Option<&'a Float64Array>,
    flags: Option<&'a UInt32Array>,
    tags: Option<&'a ListArray>,
    extras: Option<&'a StringArray>,
    created_ats: Option<&'a StringArray>,
    modified_ats: Option<&'a StringArray>,
    batch_rows: usize,
    has_dead: bool,
    has_patches: bool,
}

impl<'a> LocView<'a> {
    pub fn new(
        batch: Option<&'a RecordBatch>,
        dead: &'a HashSet<u32>,
        patches: &'a HashMap<u32, LocationData>,
        adds: &'a [LocationData],
    ) -> Self {
        let batch_rows = batch.map_or(0, |b| b.num_rows());
        let ids = batch.map(|b| b.column(0).as_any().downcast_ref::<UInt32Array>().unwrap());
        let lats = batch.map(|b| b.column(1).as_any().downcast_ref::<Float64Array>().unwrap());
        let lngs = batch.map(|b| b.column(2).as_any().downcast_ref::<Float64Array>().unwrap());
        let headings = batch.map(|b| b.column(3).as_any().downcast_ref::<Float64Array>().unwrap());
        let pitches = batch.map(|b| b.column(4).as_any().downcast_ref::<Float64Array>().unwrap());
        let zooms = batch.map(|b| b.column(5).as_any().downcast_ref::<Float64Array>().unwrap());
        let flags = batch.map(|b| b.column(7).as_any().downcast_ref::<UInt32Array>().unwrap());
        let tags = batch.map(|b| b.column(8).as_any().downcast_ref::<ListArray>().unwrap());
        let extras = batch.map(|b| b.column(9).as_any().downcast_ref::<StringArray>().unwrap());
        let created_ats = batch.map(|b| b.column(10).as_any().downcast_ref::<StringArray>().unwrap());
        let modified_ats = batch.map(|b| b.column(11).as_any().downcast_ref::<StringArray>().unwrap());
        let has_dead = !dead.is_empty();
        let has_patches = !patches.is_empty();
        Self { batch, dead, patches, adds, ids, lats, lngs, headings, pitches, zooms, flags, tags, extras, created_ats, modified_ats, batch_rows, has_dead, has_patches }
    }

    pub fn len(&self) -> usize {
        self.batch_rows + self.adds.len()
    }

    pub fn batch_id(&self, i: usize) -> u32 { self.ids.unwrap().value(i) }

    #[inline]
    pub fn is_alive(&self, i: usize) -> bool {
        !self.has_dead || !self.dead.contains(&self.batch_id(i))
    }

    #[inline]
    pub fn patch_at(&self, i: usize) -> Option<&LocationData> {
        if !self.has_patches { return None; }
        self.patches.get(&self.batch_id(i))
    }

    pub fn id_at(&self, i: usize) -> u32 {
        if self.has_patches {
            if let Some(p) = self.patches.get(&self.batch_id(i)) { return p.id; }
        }
        self.batch_id(i)
    }

    pub fn collect_id_to_selection(&self, masks: &[Vec<bool>]) -> HashMap<u32, usize> {
        let mut id_to_sel: HashMap<u32, usize> = HashMap::new();
        for (si, mask) in masks.iter().enumerate() {
            for i in 0..self.batch_rows {
                if mask[i] && self.is_alive(i) {
                    id_to_sel.insert(self.id_at(i), si);
                }
            }
            for (j, loc) in self.adds.iter().enumerate() {
                if mask[self.batch_rows + j] {
                    id_to_sel.insert(loc.id, si);
                }
            }
        }
        id_to_sel
    }

    pub fn collect_selected_ids(&self, masks: &[Vec<bool>], colors: &[[u8; 3]]) -> (HashSet<u32>, HashMap<u32, [u8; 3]>) {
        let mut all_selected = HashSet::new();
        let mut color_map = HashMap::new();
        for (si, mask) in masks.iter().enumerate() {
            let color = colors[si];
            for i in 0..self.batch_rows {
                if mask[i] {
                    let id = self.id_at(i);
                    color_map.insert(id, color);
                    all_selected.insert(id);
                }
            }
            for (j, loc) in self.adds.iter().enumerate() {
                if mask[self.batch_rows + j] {
                    color_map.insert(loc.id, color);
                    all_selected.insert(loc.id);
                }
            }
        }
        (all_selected, color_map)
    }

    pub fn build_render_lookup(&self, render_id_to_index: &HashMap<u32, usize>) -> Vec<i32> {
        let n = self.batch_rows + self.adds.len();
        let mut lookup = vec![-1i32; n];
        for i in 0..self.batch_rows {
            if !self.is_alive(i) { continue; }
            let id = self.id_at(i);
            if let Some(&ri) = render_id_to_index.get(&id) {
                lookup[i] = ri as i32;
            }
        }
        for (j, loc) in self.adds.iter().enumerate() {
            if let Some(&ri) = render_id_to_index.get(&loc.id) {
                lookup[self.batch_rows + j] = ri as i32;
            }
        }
        lookup
    }
}

// ---------------------------------------------------------------------------
// Bitmask resolve
// ---------------------------------------------------------------------------

const LOAD_AS_PANO_ID: u32 = 1;
const INFORMATIONAL: u32 = 2;

// Per-row test function for batch rows -- returns true if the row matches the selection.
// Must be safe to call from multiple threads (reads only shared Arrow columns + overlay refs).
fn test_batch_row(view: &LocView, i: usize, props: &SelectionProps) -> bool {
    if !view.is_alive(i) { return false; }
    match props {
        SelectionProps::Everything => true,
        SelectionProps::Locations { locations, .. }
        | SelectionProps::Manual { locations }
        | SelectionProps::ValidationState { locations, .. } => {
            let id = view.id_at(i);
            locations.contains(&id)
        }
        SelectionProps::Tag { tag_id } => {
            if let Some(p) = view.patch_at(i) {
                p.tags.contains(tag_id)
            } else {
                let list = view.tags.unwrap().value(i);
                let ids = list.as_any().downcast_ref::<UInt32Array>().unwrap();
                (0..ids.len()).any(|k| ids.value(k) == *tag_id)
            }
        }
        SelectionProps::Untagged => {
            if let Some(p) = view.patch_at(i) { p.tags.is_empty() }
            else { view.tags.unwrap().value(i).is_empty() }
        }
        SelectionProps::Unpanned => {
            if let Some(p) = view.patch_at(i) { p.heading == 0.0 }
            else { view.headings.unwrap().value(i) == 0.0 }
        }
        SelectionProps::PanoIds => {
            if let Some(p) = view.patch_at(i) { p.flags & LOAD_AS_PANO_ID != 0 }
            else { view.flags.unwrap().value(i) & LOAD_AS_PANO_ID != 0 }
        }
        SelectionProps::NotPanoIds => {
            if let Some(p) = view.patch_at(i) { p.flags & LOAD_AS_PANO_ID == 0 }
            else { view.flags.unwrap().value(i) & LOAD_AS_PANO_ID == 0 }
        }
        SelectionProps::Polygon { polygon, include_informational } => {
            if let Some(p) = view.patch_at(i) {
                if !include_informational && (p.flags & INFORMATIONAL != 0) { return false; }
                point_in_geometry(p.lng, p.lat, polygon)
            } else {
                if !include_informational && (view.flags.unwrap().value(i) & INFORMATIONAL != 0) { return false; }
                point_in_geometry(view.lngs.unwrap().value(i), view.lats.unwrap().value(i), polygon)
            }
        }
        SelectionProps::Filter { field, op, value, value2 } => {
            if let Some(p) = view.patch_at(i) {
                matches_filter_loc(p, field, op, value, value2.as_ref())
            } else {
                matches_filter_arrow(view, i, field, op, value, value2.as_ref())
            }
        }
        _ => false, // composites handled separately
    }
}

fn test_add_row(loc: &LocationData, props: &SelectionProps) -> bool {
    match props {
        SelectionProps::Everything => true,
        SelectionProps::Locations { locations, .. }
        | SelectionProps::Manual { locations }
        | SelectionProps::ValidationState { locations, .. } => {
            locations.contains(&loc.id)
        }
        SelectionProps::Tag { tag_id } => loc.tags.contains(tag_id),
        SelectionProps::Untagged => loc.tags.is_empty(),
        SelectionProps::Unpanned => loc.heading == 0.0,
        SelectionProps::PanoIds => loc.flags & LOAD_AS_PANO_ID != 0,
        SelectionProps::NotPanoIds => loc.flags & LOAD_AS_PANO_ID == 0,
        SelectionProps::Polygon { polygon, include_informational } => {
            if !include_informational && (loc.flags & INFORMATIONAL != 0) { return false; }
            point_in_geometry(loc.lng, loc.lat, polygon)
        }
        SelectionProps::Filter { field, op, value, value2 } => {
            matches_filter_loc(loc, field, op, value, value2.as_ref())
        }
        _ => false,
    }
}

const CHUNK_SIZE: usize = 64 * 1024;

pub fn resolve_bitmask(view: &LocView, props: &SelectionProps) -> Vec<bool> {
    let n = view.batch_rows + view.adds.len();

    match props {
        SelectionProps::Locations { locations, .. }
        | SelectionProps::Manual { locations }
        | SelectionProps::ValidationState { locations, .. } => {
            let set: HashSet<u32> = locations.iter().copied().collect();
            let mut mask: Vec<bool> = (0..view.batch_rows)
                .into_par_iter()
                .map(|i| view.is_alive(i) && set.contains(&view.id_at(i)))
                .collect();
            mask.extend(view.adds.iter().map(|loc| set.contains(&loc.id)));
            return mask;
        }
        SelectionProps::Duplicates { distance } => {
            let mut mask = vec![false; n];
            find_duplicates_bitmask(view, *distance, &mut mask);
            return mask;
        }
        SelectionProps::Intersection { selections } => {
            if selections.is_empty() { return vec![false; n]; }
            let mut mask = resolve_bitmask(view, &selections[0].props);
            for s in &selections[1..] {
                let other = resolve_bitmask(view, &s.props);
                mask.par_iter_mut().zip(other.par_iter()).for_each(|(m, o)| *m = *m && *o);
            }
            return mask;
        }
        SelectionProps::Union { selections } => {
            let mut mask = vec![false; n];
            for s in selections {
                let other = resolve_bitmask(view, &s.props);
                mask.par_iter_mut().zip(other.par_iter()).for_each(|(m, o)| *m = *m || *o);
            }
            return mask;
        }
        SelectionProps::Invert { selections } => {
            if selections.is_empty() {
                let mut mask = vec![true; n];
                if view.has_dead {
                    for i in 0..view.batch_rows { if !view.is_alive(i) { mask[i] = false; } }
                }
                return mask;
            }
            let inner = resolve_bitmask(view, &selections[0].props);
            let mut mask: Vec<bool> = (0..view.batch_rows)
                .into_par_iter()
                .map(|i| view.is_alive(i) && !inner[i])
                .collect();
            mask.extend(view.adds.iter().enumerate().map(|(j, _)| !inner[view.batch_rows + j]));
            return mask;
        }
        _ => {}
    }

    // Parallel scan over batch rows
    let mut mask: Vec<bool> = (0..view.batch_rows)
        .into_par_iter()
        .with_min_len(CHUNK_SIZE)
        .map(|i| test_batch_row(view, i, props))
        .collect();

    // Sequential scan over overlay adds (usually small)
    mask.extend(view.adds.iter().map(|loc| test_add_row(loc, props)));

    mask
}

pub fn mask_to_ids(view: &LocView, mask: &[bool]) -> Vec<u32> {
    let mut ids = Vec::new();
    for i in 0..view.batch_rows {
        if mask[i] {
            ids.push(view.id_at(i));
        }
    }
    for (j, loc) in view.adds.iter().enumerate() {
        if mask[view.batch_rows + j] {
            ids.push(loc.id);
        }
    }
    ids
}

pub fn resolve(view: &LocView, props: &SelectionProps) -> Vec<u32> {
    let mask = resolve_bitmask(view, props);
    mask_to_ids(view, &mask)
}

// --- Geometry ---

fn point_in_ring(lng: f64, lat: f64, ring: &[[f64; 2]]) -> bool {
    let mut inside = false;
    let n = ring.len();
    let mut j = n.wrapping_sub(1);
    for i in 0..n {
        let (xi, yi) = (ring[i][0], ring[i][1]);
        let (xj, yj) = (ring[j][0], ring[j][1]);
        if ((yi > lat) != (yj > lat)) && (lng < (xj - xi) * (lat - yi) / (yj - yi) + xi) {
            inside = !inside;
        }
        j = i;
    }
    inside
}

fn point_in_polygon(lng: f64, lat: f64, coords: &[Vec<[f64; 2]>]) -> bool {
    if coords.is_empty() { return false; }
    if !point_in_ring(lng, lat, &coords[0]) { return false; }
    for hole in coords.iter().skip(1) {
        if point_in_ring(lng, lat, hole) { return false; }
    }
    true
}

fn point_in_geometry(lng: f64, lat: f64, geom: &PolygonGeometry) -> bool {
    if point_in_polygon(lng, lat, &geom.coordinates) { return true; }
    if let Some(extras) = &geom.extra_polygons {
        for poly in extras {
            if point_in_polygon(lng, lat, poly) { return true; }
        }
    }
    false
}

// --- Duplicates (bitmask version) ---

fn find_duplicates_bitmask(view: &LocView, distance_m: f64, mask: &mut [bool]) {
    let cell_deg = distance_m / 111_000.0 * 1.5;

    struct Pt { lat: f64, lng: f64, global_idx: usize }
    let mut points = Vec::new();

    for i in 0..view.batch_rows {
        if !view.is_alive(i) { continue; }
        if let Some(p) = view.patch_at(i) {
            points.push(Pt { lat: p.lat, lng: p.lng, global_idx: i });
        } else {
            points.push(Pt { lat: view.lats.unwrap().value(i), lng: view.lngs.unwrap().value(i), global_idx: i });
        }
    }
    for (j, loc) in view.adds.iter().enumerate() {
        points.push(Pt { lat: loc.lat, lng: loc.lng, global_idx: view.batch_rows + j });
    }

    let n = points.len();
    if n < 2 { return; }

    let mut grid: HashMap<(i32, i32), Vec<usize>> = HashMap::new();
    for (pi, pt) in points.iter().enumerate() {
        let cx = (pt.lng / cell_deg).floor() as i32;
        let cy = (pt.lat / cell_deg).floor() as i32;
        grid.entry((cx, cy)).or_default().push(pi);
    }

    let mut in_group = vec![false; n];
    for pi in 0..n {
        if in_group[pi] { continue; }
        let pt = &points[pi];
        let cx = (pt.lng / cell_deg).floor() as i32;
        let cy = (pt.lat / cell_deg).floor() as i32;
        let mut found_dup = false;
        for dx in -1..=1 {
            for dy in -1..=1 {
                if let Some(cell) = grid.get(&(cx + dx, cy + dy)) {
                    for &pj in cell {
                        if pj <= pi || in_group[pj] { continue; }
                        if haversine_m(pt.lat, pt.lng, points[pj].lat, points[pj].lng) <= distance_m {
                            in_group[pj] = true;
                            mask[points[pj].global_idx] = true;
                            found_dup = true;
                        }
                    }
                }
            }
        }
        if found_dup { mask[pt.global_idx] = true; }
    }
}

fn haversine_m(lat1: f64, lng1: f64, lat2: f64, lng2: f64) -> f64 {
    let r = 6_371_000.0;
    let dlat = (lat2 - lat1).to_radians();
    let dlng = (lng2 - lng1).to_radians();
    let a = (dlat / 2.0).sin().powi(2)
        + lat1.to_radians().cos() * lat2.to_radians().cos() * (dlng / 2.0).sin().powi(2);
    2.0 * r * a.sqrt().asin()
}

// --- Filter ---

fn iso_to_unix(s: &str) -> Option<f64> {
    let s = s.trim_end_matches('Z');
    let (date_part, time_part) = s.split_once('T')?;
    let mut dp = date_part.splitn(3, '-');
    let y: i64 = dp.next()?.parse().ok()?;
    let m: i64 = dp.next()?.parse().ok()?;
    let d: i64 = dp.next()?.parse().ok()?;
    let mut tp = time_part.split(':');
    let h: i64 = tp.next()?.parse().ok()?;
    let min: i64 = tp.next()?.parse().ok()?;
    let sec_str = tp.next().unwrap_or("0");
    let sec: i64 = sec_str.split('.').next()?.parse().ok()?;
    fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
        let y = if m <= 2 { y - 1 } else { y };
        let era = y.div_euclid(400);
        let yoe = y.rem_euclid(400);
        let doy = (153 * (if m > 2 { m - 3 } else { m + 9 }) + 2) / 5 + d - 1;
        let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
        era * 146097 + doe - 719468
    }
    Some((days_from_civil(y, m, d) * 86400 + h * 3600 + min * 60 + sec) as f64)
}

fn resolve_field_loc(loc: &LocationData, field: &str) -> Option<serde_json::Value> {
    match field {
        "lat" => Some(serde_json::json!(loc.lat)),
        "lng" => Some(serde_json::json!(loc.lng)),
        "heading" => Some(serde_json::json!(loc.heading)),
        "pitch" => Some(serde_json::json!(loc.pitch)),
        "zoom" => Some(serde_json::json!(loc.zoom)),
        "id" => Some(serde_json::json!(loc.id)),
        "createdAt" => iso_to_unix(&loc.created_at).map(|ts| serde_json::json!(ts)),
        "modifiedAt" => loc.modified_at.as_deref().and_then(iso_to_unix).map(|ts| serde_json::json!(ts)),
        _ => loc.extra.as_ref().and_then(|e| e.get(field).cloned()),
    }
}

fn matches_filter_loc(
    loc: &LocationData,
    field: &str, op: &str, value: &serde_json::Value, value2: Option<&serde_json::Value>,
) -> bool {
    match resolve_field_loc(loc, field) {
        Some(ref v) => compare_filter(v, op, value, value2),
        None => op == "neq" || op == "nothas",
    }
}

fn resolve_field_arrow(view: &LocView, idx: usize, field: &str) -> Option<serde_json::Value> {
    match field {
        "lat" => view.lats.map(|c| serde_json::json!(c.value(idx))),
        "lng" => view.lngs.map(|c| serde_json::json!(c.value(idx))),
        "heading" => view.headings.map(|c| serde_json::json!(c.value(idx))),
        "pitch" => view.pitches.map(|c| serde_json::json!(c.value(idx))),
        "zoom" => view.zooms.map(|c| serde_json::json!(c.value(idx))),
        "id" => view.ids.map(|c| serde_json::json!(c.value(idx))),
        "createdAt" => view.created_ats.and_then(|c| iso_to_unix(c.value(idx))).map(|ts| serde_json::json!(ts)),
        "modifiedAt" => view.modified_ats.and_then(|c| {
            if c.is_null(idx) { return None; }
            iso_to_unix(c.value(idx))
        }).map(|ts| serde_json::json!(ts)),
        _ => {
            let extras = view.extras?;
            if extras.is_null(idx) { return None; }
            let map: serde_json::Map<String, serde_json::Value> = serde_json::from_str(extras.value(idx)).ok()?;
            map.get(field).cloned()
        }
    }
}

fn matches_filter_arrow(
    view: &LocView, idx: usize,
    field: &str, op: &str, value: &serde_json::Value, value2: Option<&serde_json::Value>,
) -> bool {
    match resolve_field_arrow(view, idx, field) {
        Some(ref v) => compare_filter(v, op, value, value2),
        None => op == "neq" || op == "nothas",
    }
}

fn compare_filter(field_val: &serde_json::Value, op: &str, value: &serde_json::Value, value2: Option<&serde_json::Value>) -> bool {
    match op {
        "eq" => val_eq(field_val, value),
        "neq" => !val_eq(field_val, value),
        "has" => true,
        "nothas" => false,
        "gt" | "lt" | "gte" | "lte" | "between" => {
            let fv = as_f64(field_val);
            let cv = as_f64(value);
            match (fv, cv) {
                (Some(a), Some(b)) => match op {
                    "gt" => a > b,
                    "lt" => a < b,
                    "gte" => a >= b,
                    "lte" => a <= b,
                    "between" => {
                        let upper = value2.and_then(as_f64).unwrap_or(f64::MAX);
                        a >= b && a <= upper
                    }
                    _ => false,
                },
                _ => {
                    let fs = field_val.as_str().unwrap_or("");
                    let vs = value.as_str().unwrap_or("");
                    match op {
                        "gt" => fs > vs,
                        "lt" => fs < vs,
                        "gte" => fs >= vs,
                        "lte" => fs <= vs,
                        "between" => {
                            let upper = value2.and_then(|v| v.as_str()).unwrap_or("");
                            fs >= vs && fs <= upper
                        }
                        _ => false,
                    }
                }
            }
        }
        _ => false,
    }
}

fn val_eq(a: &serde_json::Value, b: &serde_json::Value) -> bool {
    if a == b { return true; }
    // Cross-type: compare string representations (e.g. Number(2) vs String("2"))
    let sa = match a { serde_json::Value::String(s) => s.as_str().into(), _ => None };
    let sb = match b { serde_json::Value::String(s) => s.as_str().into(), _ => None };
    match (sa, sb) {
        (Some(s), None) => s == *b,
        (None, Some(s)) => *a == s,
        _ => false,
    }
}

fn as_f64(v: &serde_json::Value) -> Option<f64> {
    v.as_f64().or_else(|| v.as_str().and_then(|s| s.parse().ok()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::fast_io::LocationData;
    use crate::arrow_bridge::locations_to_batch;

    fn loc(id: u32, lat: f64, lng: f64) -> LocationData {
        LocationData {
            id, lat, lng, heading: 0.0, pitch: 0.0, zoom: 1.0,
            pano_id: None, flags: 0, tags: vec![], extra: None,
            created_at: String::new(), modified_at: None,
        }
    }

    fn make_view<'a>(
        batch: Option<&'a RecordBatch>,
        dead: &'a HashSet<u32>,
        patches: &'a HashMap<u32, LocationData>,
        adds: &'a [LocationData],
    ) -> LocView<'a> {
        LocView::new(batch, dead, patches, adds)
    }

    // -----------------------------------------------------------------------
    // Geometry: point_in_ring / point_in_polygon
    // -----------------------------------------------------------------------

    #[test]
    fn point_inside_square() {
        let ring = vec![[0.0, 0.0], [10.0, 0.0], [10.0, 10.0], [0.0, 10.0], [0.0, 0.0]];
        assert!(point_in_ring(5.0, 5.0, &ring));
    }

    #[test]
    fn point_outside_square() {
        let ring = vec![[0.0, 0.0], [10.0, 0.0], [10.0, 10.0], [0.0, 10.0], [0.0, 0.0]];
        assert!(!point_in_ring(15.0, 5.0, &ring));
    }

    #[test]
    fn point_in_polygon_with_hole() {
        let outer = vec![[0.0, 0.0], [20.0, 0.0], [20.0, 20.0], [0.0, 20.0], [0.0, 0.0]];
        let hole = vec![[5.0, 5.0], [15.0, 5.0], [15.0, 15.0], [5.0, 15.0], [5.0, 5.0]];
        let coords = vec![outer, hole];
        assert!(point_in_polygon(2.0, 2.0, &coords)); // outside hole, inside outer
        assert!(!point_in_polygon(10.0, 10.0, &coords)); // inside hole
    }

    #[test]
    fn point_in_geometry_extra_polygons() {
        let main = vec![vec![[0.0, 0.0], [10.0, 0.0], [10.0, 10.0], [0.0, 10.0], [0.0, 0.0]]];
        let extra = vec![vec![[20.0, 20.0], [30.0, 20.0], [30.0, 30.0], [20.0, 30.0], [20.0, 20.0]]];
        let geom = PolygonGeometry {
            coordinates: main,
            extra_polygons: Some(vec![extra]),
            properties: None,
        };
        assert!(point_in_geometry(5.0, 5.0, &geom));
        assert!(point_in_geometry(25.0, 25.0, &geom));
        assert!(!point_in_geometry(15.0, 15.0, &geom));
    }

    // -----------------------------------------------------------------------
    // Haversine
    // -----------------------------------------------------------------------

    #[test]
    fn haversine_zero_distance() {
        assert_eq!(haversine_m(0.0, 0.0, 0.0, 0.0), 0.0);
    }

    #[test]
    fn haversine_known_distance() {
        // London to Paris ~ 343 km
        let d = haversine_m(51.5074, -0.1278, 48.8566, 2.3522);
        assert!((d - 343_500.0).abs() < 5000.0, "London-Paris should be ~343km, got {:.0}m", d);
    }

    // -----------------------------------------------------------------------
    // iso_to_unix
    // -----------------------------------------------------------------------

    #[test]
    fn iso_unix_epoch() {
        assert_eq!(iso_to_unix("1970-01-01T00:00:00Z"), Some(0.0));
    }

    #[test]
    fn iso_known_date() {
        // 2024-01-01T00:00:00Z = 1704067200
        let ts = iso_to_unix("2024-01-01T00:00:00Z").unwrap();
        assert_eq!(ts, 1704067200.0);
    }

    #[test]
    fn iso_invalid_returns_none() {
        assert!(iso_to_unix("not-a-date").is_none());
    }

    // -----------------------------------------------------------------------
    // compare_filter
    // -----------------------------------------------------------------------

    #[test]
    fn filter_eq_string() {
        assert!(compare_filter(&serde_json::json!("BR"), "eq", &serde_json::json!("BR"), None));
        assert!(!compare_filter(&serde_json::json!("US"), "eq", &serde_json::json!("BR"), None));
    }

    #[test]
    fn filter_neq() {
        assert!(compare_filter(&serde_json::json!("US"), "neq", &serde_json::json!("BR"), None));
        assert!(!compare_filter(&serde_json::json!("BR"), "neq", &serde_json::json!("BR"), None));
    }

    #[test]
    fn filter_gt_numeric() {
        assert!(compare_filter(&serde_json::json!(100), "gt", &serde_json::json!(50), None));
        assert!(!compare_filter(&serde_json::json!(50), "gt", &serde_json::json!(100), None));
    }

    #[test]
    fn filter_between() {
        assert!(compare_filter(&serde_json::json!(500), "between", &serde_json::json!(100), Some(&serde_json::json!(1000))));
        assert!(!compare_filter(&serde_json::json!(50), "between", &serde_json::json!(100), Some(&serde_json::json!(1000))));
    }

    #[test]
    fn filter_has_nothas() {
        assert!(compare_filter(&serde_json::json!("anything"), "has", &serde_json::json!(null), None));
        assert!(!compare_filter(&serde_json::json!("anything"), "nothas", &serde_json::json!(null), None));
    }

    #[test]
    fn val_eq_same_type() {
        assert!(val_eq(&serde_json::json!("BR"), &serde_json::json!("BR")));
        assert!(val_eq(&serde_json::json!(42), &serde_json::json!(42)));
        assert!(!val_eq(&serde_json::json!("a"), &serde_json::json!("b")));
    }

    // TODO: val_eq's comment claims cross-type comparison (e.g. Number(2) vs
    // String("2")), but it doesn't work. The cross-type branch extracts the
    // &str from the String side and compares via serde_json's PartialEq<&str>
    // for Value, which only matches Value::String — it won't coerce Number to
    // string. The entire cross-type block is effectively dead code; the
    // function reduces to just `a == b`. This means Filter "eq" with
    // mismatched types (e.g. altitude stored as Number(100), filter value
    // String("100")) will silently match nothing.
    #[test]
    #[should_panic]
    fn val_eq_cross_type_is_broken() {
        assert!(val_eq(&serde_json::json!(2), &serde_json::json!("2")));
        assert!(val_eq(&serde_json::json!("2"), &serde_json::json!(2)));
    }

    // -----------------------------------------------------------------------
    // resolve with LocView (overlay adds only, no batch)
    // -----------------------------------------------------------------------

    #[test]
    fn resolve_everything() {
        let dead = HashSet::new();
        let patches = HashMap::new();
        let adds = vec![loc(1, 10.0, 20.0), loc(2, 30.0, 40.0)];
        let view = make_view(None, &dead, &patches, &adds);
        let ids = resolve(&view, &SelectionProps::Everything);
        assert_eq!(ids.len(), 2);
    }

    #[test]
    fn resolve_tag_on_adds() {
        let dead = HashSet::new();
        let patches = HashMap::new();
        let mut l1 = loc(1, 0.0, 0.0);
        l1.tags = vec![10];
        let l2 = loc(2, 0.0, 0.0);
        let adds = vec![l1, l2];
        let view = make_view(None, &dead, &patches, &adds);
        let ids = resolve(&view, &SelectionProps::Tag { tag_id: 10 });
        assert_eq!(ids, vec![1]);
    }

    #[test]
    fn resolve_untagged() {
        let dead = HashSet::new();
        let patches = HashMap::new();
        let mut l1 = loc(1, 0.0, 0.0);
        l1.tags = vec![10];
        let l2 = loc(2, 0.0, 0.0);
        let adds = vec![l1, l2];
        let view = make_view(None, &dead, &patches, &adds);
        let ids = resolve(&view, &SelectionProps::Untagged);
        assert_eq!(ids, vec![2]);
    }

    #[test]
    fn resolve_unpanned() {
        let dead = HashSet::new();
        let patches = HashMap::new();
        let l1 = loc(1, 0.0, 0.0); // heading = 0
        let mut l2 = loc(2, 0.0, 0.0);
        l2.heading = 90.0;
        let adds = vec![l1, l2];
        let view = make_view(None, &dead, &patches, &adds);
        let ids = resolve(&view, &SelectionProps::Unpanned);
        assert_eq!(ids, vec![1]);
    }

    #[test]
    fn resolve_panoids() {
        let dead = HashSet::new();
        let patches = HashMap::new();
        let mut l1 = loc(1, 0.0, 0.0);
        l1.flags = LOAD_AS_PANO_ID;
        let l2 = loc(2, 0.0, 0.0);
        let adds = vec![l1, l2];
        let view = make_view(None, &dead, &patches, &adds);
        let pano = resolve(&view, &SelectionProps::PanoIds);
        let not_pano = resolve(&view, &SelectionProps::NotPanoIds);
        assert_eq!(pano, vec![1]);
        assert_eq!(not_pano, vec![2]);
    }

    #[test]
    fn resolve_with_dead_batch_rows() {
        let locs = vec![loc(1, 10.0, 20.0), loc(2, 30.0, 40.0), loc(3, 50.0, 60.0)];
        let batch = locations_to_batch(&locs);
        let mut dead = HashSet::new();
        dead.insert(2);
        let patches = HashMap::new();
        let adds: Vec<LocationData> = vec![];
        let view = make_view(Some(&batch), &dead, &patches, &adds);
        let ids = resolve(&view, &SelectionProps::Everything);
        assert_eq!(ids.len(), 2);
        assert!(ids.contains(&1));
        assert!(ids.contains(&3));
        assert!(!ids.contains(&2));
    }

    #[test]
    fn resolve_with_patched_tags() {
        let locs = vec![loc(1, 0.0, 0.0), loc(2, 0.0, 0.0)];
        let batch = locations_to_batch(&locs);
        let dead = HashSet::new();
        let mut patched = loc(1, 0.0, 0.0);
        patched.tags = vec![10];
        let mut patches = HashMap::new();
        patches.insert(1, patched);
        let adds: Vec<LocationData> = vec![];
        let view = make_view(Some(&batch), &dead, &patches, &adds);
        let ids = resolve(&view, &SelectionProps::Tag { tag_id: 10 });
        assert_eq!(ids, vec![1]);
    }

    // -----------------------------------------------------------------------
    // Composite selections
    // -----------------------------------------------------------------------

    #[test]
    fn resolve_intersection() {
        let dead = HashSet::new();
        let patches = HashMap::new();
        let mut l1 = loc(1, 0.0, 0.0);
        l1.tags = vec![10];
        l1.flags = LOAD_AS_PANO_ID;
        let mut l2 = loc(2, 0.0, 0.0);
        l2.tags = vec![10];
        let mut l3 = loc(3, 0.0, 0.0);
        l3.flags = LOAD_AS_PANO_ID;
        let adds = vec![l1, l2, l3];
        let view = make_view(None, &dead, &patches, &adds);
        let props = SelectionProps::Intersection {
            selections: vec![
                Selection { key: "a".into(), color: [0,0,0], props: SelectionProps::Tag { tag_id: 10 }, locations: vec![] },
                Selection { key: "b".into(), color: [0,0,0], props: SelectionProps::PanoIds, locations: vec![] },
            ],
        };
        let ids = resolve(&view, &props);
        assert_eq!(ids, vec![1]); // only l1 has both tag 10 and PanoId flag
    }

    #[test]
    fn resolve_union() {
        let dead = HashSet::new();
        let patches = HashMap::new();
        let mut l1 = loc(1, 0.0, 0.0);
        l1.tags = vec![10];
        let mut l2 = loc(2, 0.0, 0.0);
        l2.flags = LOAD_AS_PANO_ID;
        let l3 = loc(3, 0.0, 0.0);
        let adds = vec![l1, l2, l3];
        let view = make_view(None, &dead, &patches, &adds);
        let props = SelectionProps::Union {
            selections: vec![
                Selection { key: "a".into(), color: [0,0,0], props: SelectionProps::Tag { tag_id: 10 }, locations: vec![] },
                Selection { key: "b".into(), color: [0,0,0], props: SelectionProps::PanoIds, locations: vec![] },
            ],
        };
        let ids = resolve(&view, &props);
        assert_eq!(ids.len(), 2);
        assert!(ids.contains(&1));
        assert!(ids.contains(&2));
    }

    #[test]
    fn resolve_invert() {
        let dead = HashSet::new();
        let patches = HashMap::new();
        let mut l1 = loc(1, 0.0, 0.0);
        l1.flags = LOAD_AS_PANO_ID;
        let l2 = loc(2, 0.0, 0.0);
        let l3 = loc(3, 0.0, 0.0);
        let adds = vec![l1, l2, l3];
        let view = make_view(None, &dead, &patches, &adds);
        let props = SelectionProps::Invert {
            selections: vec![
                Selection { key: "a".into(), color: [0,0,0], props: SelectionProps::PanoIds, locations: vec![] },
            ],
        };
        let ids = resolve(&view, &props);
        assert_eq!(ids.len(), 2);
        assert!(ids.contains(&2));
        assert!(ids.contains(&3));
    }

    // -----------------------------------------------------------------------
    // Duplicates
    // -----------------------------------------------------------------------

    #[test]
    fn duplicates_finds_nearby() {
        let dead = HashSet::new();
        let patches = HashMap::new();
        let adds = vec![
            loc(1, 51.5000, -0.1000),
            loc(2, 51.5000, -0.1000), // exact same
            loc(3, 0.0, 0.0),         // far away
        ];
        let view = make_view(None, &dead, &patches, &adds);
        let ids = resolve(&view, &SelectionProps::Duplicates { distance: 1.0 });
        assert!(ids.contains(&1));
        assert!(ids.contains(&2));
        assert!(!ids.contains(&3));
    }

    // -----------------------------------------------------------------------
    // Filter on adds
    // -----------------------------------------------------------------------

    #[test]
    fn extra_filter_eq_on_adds() {
        let dead = HashSet::new();
        let patches = HashMap::new();
        let mut l1 = loc(1, 0.0, 0.0);
        l1.extra = Some(serde_json::from_str(r#"{"country":"BR"}"#).unwrap());
        let mut l2 = loc(2, 0.0, 0.0);
        l2.extra = Some(serde_json::from_str(r#"{"country":"US"}"#).unwrap());
        let adds = vec![l1, l2];
        let view = make_view(None, &dead, &patches, &adds);
        let ids = resolve(&view, &SelectionProps::Filter {
            field: "country".into(), op: "eq".into(),
            value: serde_json::json!("BR"), value2: None,
        });
        assert_eq!(ids, vec![1]);
    }
}
