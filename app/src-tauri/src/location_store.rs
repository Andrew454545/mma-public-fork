use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};

use arrow::array::{
    Array, ArrayRef, Float64Array, ListArray, RecordBatch,
    StringArray, UInt32Array,
};
use arrow::compute::concat_batches;
use arrow::datatypes::SchemaRef;
use rayon::prelude::*;
use tauri::{ipc::Response, Manager};

use crate::arrow_bridge;
use crate::fast_io::{self, LocationData};
use crate::selections::{self, SelectionProps, Selection, SelectionSummary};

const GEOHASH_PRECISION: usize = 2;
const RENDER_PRECISION: usize = 1;
const MAX_UNDO_ENTRIES: usize = 1000;
const BASE32: &[u8] = b"0123456789bcdefghjkmnpqrstuvwxyz";

pub(crate) fn encode_geohash(lat: f64, lng: f64) -> String {
    let (mut min_lat, mut max_lat) = (-90.0, 90.0);
    let (mut min_lng, mut max_lng) = (-180.0, 180.0);
    let mut hash = String::with_capacity(GEOHASH_PRECISION);
    let mut bits = 0u8;
    let mut ch = 0u8;
    let mut even = true;
    while hash.len() < GEOHASH_PRECISION {
        if even {
            let mid = (min_lng + max_lng) / 2.0;
            if lng >= mid { ch = (ch << 1) | 1; min_lng = mid; } else { ch <<= 1; max_lng = mid; }
        } else {
            let mid = (min_lat + max_lat) / 2.0;
            if lat >= mid { ch = (ch << 1) | 1; min_lat = mid; } else { ch <<= 1; max_lat = mid; }
        }
        even = !even;
        bits += 1;
        if bits == 5 { hash.push(BASE32[ch as usize] as char); bits = 0; ch = 0; }
    }
    hash
}

fn render_cell_key(gh: &str) -> &str {
    &gh[..RENDER_PRECISION]
}


fn render_cell_idx(lat: f64, lng: f64) -> u8 {
    let (mut min_lat, mut max_lat) = (-90.0, 90.0);
    let (mut min_lng, mut max_lng) = (-180.0, 180.0);
    let mut ch: u8 = 0;
    let mut even = true;
    for _ in 0..5 {
        if even {
            let mid = (min_lng + max_lng) / 2.0;
            if lng >= mid { ch = (ch << 1) | 1; min_lng = mid; } else { ch <<= 1; max_lng = mid; }
        } else {
            let mid = (min_lat + max_lat) / 2.0;
            if lat >= mid { ch = (ch << 1) | 1; min_lat = mid; } else { ch <<= 1; max_lat = mid; }
        }
        even = !even;
    }
    ch
}

fn cell_key_from_idx(idx: u8) -> String {
    String::from(BASE32[idx as usize] as char)
}

// ---------------------------------------------------------------------------
// Column accessors — typed downcasts from a RecordBatch
// ---------------------------------------------------------------------------

fn col_id(b: &RecordBatch) -> &UInt32Array { b.column(0).as_any().downcast_ref().unwrap() }
fn col_lat(b: &RecordBatch) -> &Float64Array { b.column(1).as_any().downcast_ref().unwrap() }
fn col_lng(b: &RecordBatch) -> &Float64Array { b.column(2).as_any().downcast_ref().unwrap() }
fn col_heading(b: &RecordBatch) -> &Float64Array { b.column(3).as_any().downcast_ref().unwrap() }
fn col_flags(b: &RecordBatch) -> &UInt32Array { b.column(7).as_any().downcast_ref().unwrap() }
fn col_tags(b: &RecordBatch) -> &ListArray { b.column(8).as_any().downcast_ref().unwrap() }
fn col_extra(b: &RecordBatch) -> &StringArray { b.column(9).as_any().downcast_ref().unwrap() }

fn num_rows(store: &Store) -> usize { store.batch.as_ref().map_or(0, |b| b.num_rows()) }

fn schema() -> SchemaRef { Arc::new(arrow_bridge::location_schema()) }

fn empty_batch() -> RecordBatch {
    RecordBatch::new_empty(schema())
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

pub(crate) struct CellRender {
    pub id_order: Vec<u32>,
    pub id_to_index: HashMap<u32, usize>,
}

pub struct Store {
    pub(crate) map_id: Option<String>,
    // Arrow batch = immutable base snapshot, loaded from disk
    pub(crate) batch: Option<RecordBatch>,
    // Overlay: mutations accumulate here, merged into batch on save/close
    pub(crate) overlay_adds: Vec<LocationData>,
    overlay_dead: HashSet<u32>,
    overlay_patches: HashMap<u32, LocationData>,
    // Indexes (cover batch + overlay)
    pub(crate) id_to_index: HashMap<u32, usize>,
    pub(crate) geohash_index: HashMap<String, Vec<usize>>,
    dirty_geohashes: HashSet<String>,
    pub(crate) dirty: bool,
    pub(crate) tag_counts: HashMap<u32, usize>,
    next_id: u32,
    next_tag_id: u32,
    version: u64,
    // Per-cell render tracking
    pub(crate) render_cells: HashMap<String, CellRender>,
    pub(crate) id_to_cell: HashMap<u32, String>,
    pub selections: Vec<Selection>,
    pub selection_version: u64,
    selected_ids: HashSet<u32>,
    selected_colors: HashMap<u32, [u8; 3]>,
    active_id: Option<u32>,
    pub(crate) alive_count: usize,
    pub(crate) undo_stack: Vec<EditEntry>,
    pub(crate) redo_stack: Vec<EditEntry>,
    committed_blobs: HashMap<String, (String, u32)>,
}

#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub(crate) struct EditEntry {
    pub created: Vec<LocationData>,
    pub removed: Vec<LocationData>,
}

impl Store {
    pub fn new() -> Self {
        Self {
            map_id: None,
            batch: None,
            overlay_adds: Vec::new(),
            overlay_dead: HashSet::new(),
            overlay_patches: HashMap::new(),
            id_to_index: HashMap::new(),
            geohash_index: HashMap::new(),
            dirty_geohashes: HashSet::new(),
            dirty: false,
            tag_counts: HashMap::new(),
            next_id: 1,
            next_tag_id: 1,
            version: 0,
            render_cells: HashMap::new(),
            id_to_cell: HashMap::new(),
            selections: Vec::new(),
            selection_version: 0,
            selected_ids: HashSet::new(),
            selected_colors: HashMap::new(),
            active_id: None,
            alive_count: 0,
            undo_stack: Vec::new(),
            redo_stack: Vec::new(),
            committed_blobs: HashMap::new(),
        }
    }

    pub(crate) fn bump(&mut self) -> u64 {
        self.version += 1;
        self.version
    }

    pub(crate) fn finish_mutation(&mut self, delta: RenderDelta) -> MutationResult {
        let version = self.bump();
        MutationResult {
            version,
            delta,
            location_count: self.alive_count,
            can_undo: !self.undo_stack.is_empty(),
            can_redo: !self.redo_stack.is_empty(),
            tag_counts: self.tag_counts.clone(),
        }
    }

    pub(crate) fn mark_dirty(&mut self, lat: f64, lng: f64) {
        self.dirty_geohashes.insert(encode_geohash(lat, lng));
    }

    pub(crate) fn add_tag_counts(&mut self, locs: &[LocationData]) {
        for loc in locs {
            for &tag in &loc.tags { *self.tag_counts.entry(tag).or_default() += 1; }
        }
    }

    pub(crate) fn remove_tag_counts(&mut self, locs: &[LocationData]) {
        for loc in locs {
            for &tag in &loc.tags {
                if let Some(c) = self.tag_counts.get_mut(&tag) { *c = c.saturating_sub(1); }
            }
        }
    }

    pub(crate) fn cell_add_render(&mut self, cell: &str, id: u32) -> usize {
        let cr = self.render_cells.entry(cell.to_string()).or_insert_with(|| CellRender {
            id_order: Vec::new(),
            id_to_index: HashMap::new(),
        });
        let idx = cr.id_order.len();
        cr.id_to_index.insert(id, idx);
        cr.id_order.push(id);
        self.id_to_cell.insert(id, cell.to_string());
        idx
    }

    fn cell_remove_render(&mut self, id: u32) -> Option<CellRemoval> {
        let cell = self.id_to_cell.remove(&id)?;
        let cr = self.render_cells.get_mut(&cell)?;
        let idx = cr.id_to_index.remove(&id)?;
        let last = cr.id_order.len() - 1;
        if idx != last {
            let moved_id = cr.id_order[last];
            cr.id_order[idx] = moved_id;
            cr.id_to_index.insert(moved_id, idx);
        }
        cr.id_order.pop();
        Some(CellRemoval { cell, cell_index: idx, id })
    }

    fn cell_lookup(&self, id: u32) -> Option<(String, usize)> {
        let cell = self.id_to_cell.get(&id)?;
        let cr = self.render_cells.get(cell)?;
        let idx = *cr.id_to_index.get(&id)?;
        Some((cell.clone(), idx))
    }

    pub(crate) fn alloc_id(&mut self) -> u32 {
        let id = self.next_id;
        self.next_id += 1;
        id
    }

    pub(crate) fn alloc_tag_id(&mut self) -> u32 {
        let id = self.next_tag_id;
        self.next_tag_id += 1;
        id
    }

    pub(crate) fn push_undo(&mut self, entry: EditEntry) {
        self.undo_stack.push(entry);
        if self.undo_stack.len() > MAX_UNDO_ENTRIES {
            self.undo_stack.drain(..self.undo_stack.len() - MAX_UNDO_ENTRIES);
        }
    }

    fn batch_ref(&self) -> &RecordBatch {
        self.batch.as_ref().expect("no map open")
    }

    fn get_loc_by_id(&self, id: u32) -> Option<LocationData> {
        if self.overlay_dead.contains(&id) { return None; }
        if let Some(patched) = self.overlay_patches.get(&id) { return Some(patched.clone()); }
        for loc in &self.overlay_adds {
            if loc.id == id { return Some(loc.clone()); }
        }
        if let (Some(b), Some(&idx)) = (&self.batch, self.id_to_index.get(&id)) {
            if idx < b.num_rows() {
                return Some(arrow_bridge::row_to_location(b, idx));
            }
        }
        None
    }

    fn get_loc(&self, idx: usize) -> LocationData {
        let loc = arrow_bridge::row_to_location(self.batch_ref(), idx);
        if let Some(patched) = self.overlay_patches.get(&loc.id) {
            return patched.clone();
        }
        loc
    }
    
    /// Collect all alive locations (batch + overlay) as Vec for serialization.
    pub(crate) fn collect_all_locations(&self) -> Vec<LocationData> {
        let mut locs = Vec::new();
        if let Some(ref b) = self.batch {
            for i in 0..b.num_rows() {
                let id = col_id(b).value(i);
                if self.overlay_dead.contains(&id) { continue; }
                if let Some(patched) = self.overlay_patches.get(&id) {
                    locs.push(patched.clone());
                } else {
                    locs.push(arrow_bridge::row_to_location(b, i));
                }
            }
        }
        locs.extend(self.overlay_adds.iter().cloned());
        locs
    }

    fn loc_view(&self) -> selections::LocView<'_> {
        selections::LocView::new(
            self.batch.as_ref(),
            &self.overlay_dead,
            &self.overlay_patches,
            &self.overlay_adds,
        )
    }

    pub(crate) fn overlay_add(&mut self, loc: LocationData) {
        self.mark_dirty(loc.lat, loc.lng);
        self.dirty = true;
        self.alive_count += 1;
        if self.id_to_index.contains_key(&loc.id) {
            self.overlay_dead.remove(&loc.id);
            self.overlay_patches.insert(loc.id, loc);
        } else {
            self.overlay_dead.remove(&loc.id);
            self.overlay_adds.push(loc);
        }
    }

    fn overlay_remove(&mut self, locs: &[LocationData]) {
        let remove_set: HashSet<u32> = locs.iter().map(|l| l.id).collect();
        for loc in locs {
            self.mark_dirty(loc.lat, loc.lng);
            self.alive_count -= 1;
            self.overlay_patches.remove(&loc.id);
        }
        self.overlay_dead.extend(&remove_set);
        self.overlay_adds.retain(|l| !remove_set.contains(&l.id));
        self.dirty = true;
    }

    fn overlay_update(&mut self, id: u32, patch: &LocationPatch) {
        let mut loc = match self.get_loc_by_id(id) {
            Some(l) => l,
            None => return,
        };
        self.mark_dirty(loc.lat, loc.lng);
        if let Some(v) = patch.lat { loc.lat = v; }
        if let Some(v) = patch.lng { loc.lng = v; }
        if let Some(v) = patch.heading { loc.heading = v; }
        if let Some(v) = patch.pitch { loc.pitch = v; }
        if let Some(v) = patch.zoom { loc.zoom = v; }
        if let Some(ref v) = patch.pano_id { loc.pano_id = v.clone(); }
        if let Some(v) = patch.flags { loc.flags = v; }
        if let Some(ref v) = patch.tags { loc.tags = v.clone(); }
        if let Some(ref v) = patch.extra { loc.extra = v.clone(); }
        if let Some(ref v) = patch.created_at { loc.created_at = v.clone(); }
        if let Some(ref v) = patch.modified_at { loc.modified_at = v.clone(); }
        self.mark_dirty(loc.lat, loc.lng);
        // If it's in overlay_adds, update in place
        if let Some(pos) = self.overlay_adds.iter().position(|l| l.id == id) {
            self.overlay_adds[pos] = loc;
        } else {
            self.overlay_patches.insert(id, loc);
        }
        self.dirty = true;
    }

    fn clear_overlay(&mut self) {
        self.overlay_adds.clear();
        self.overlay_dead.clear();
        self.overlay_patches.clear();
        self.dirty = false;
    }

    /// Bake overlay into the batch — called on save/close.
    pub(crate) fn bake_overlay(&mut self) {
        if !self.dirty { return; }
        let _t = std::time::Instant::now();

        let mut batch = match self.batch.take() {
            Some(b) => b,
            None => {
                // No batch yet, just convert adds
                let b = arrow_bridge::locations_to_batch(&self.overlay_adds);
                self.clear_overlay();
                self.batch = Some(b);
                self.rebuild_index();
                return;
            }
        };

        // Step 1: filter out dead rows
        if !self.overlay_dead.is_empty() {
            let ids = col_id(&batch);
            let keep: Vec<u32> = (0..batch.num_rows())
                .filter(|&i| !self.overlay_dead.contains(&ids.value(i)))
                .map(|i| i as u32)
                .collect();
            if keep.len() < batch.num_rows() {
                let take_idx = arrow::array::UInt32Array::from(keep);
                batch = RecordBatch::try_new(
                    batch.schema(),
                    batch.columns().iter().map(|col| {
                        arrow::compute::take(col.as_ref(), &take_idx, None).unwrap()
                    }).collect(),
                ).unwrap();
            }
        }

        // Step 2: apply patches -- remove patched rows, concat replacement batch
        if !self.overlay_patches.is_empty() {
            let ids = col_id(&batch);
            let keep: Vec<u32> = (0..batch.num_rows())
                .filter(|&i| !self.overlay_patches.contains_key(&ids.value(i)))
                .map(|i| i as u32)
                .collect();
            if keep.len() < batch.num_rows() {
                let patched_locs: Vec<LocationData> = self.overlay_patches.values().cloned().collect();
                let take_idx = arrow::array::UInt32Array::from(keep);
                let filtered = RecordBatch::try_new(
                    batch.schema(),
                    batch.columns().iter().map(|col| {
                        arrow::compute::take(col.as_ref(), &take_idx, None).unwrap()
                    }).collect(),
                ).unwrap();
                drop(batch);
                let patch_batch = arrow_bridge::locations_to_batch(&patched_locs);
                let s = schema();
                batch = arrow::compute::concat_batches(&s, &[filtered, patch_batch])
                    .expect("concat failed");
            }
        }

        // Step 3: concat adds
        if !self.overlay_adds.is_empty() {
            let add_batch = arrow_bridge::locations_to_batch(&self.overlay_adds);
            let s = schema();
            batch = arrow::compute::concat_batches(&s, &[batch, add_batch])
                .expect("concat failed");
        }

        log::debug!("[bake_overlay] total={}ms rows={}", _t.elapsed().as_millis(), batch.num_rows());
        self.batch = Some(batch);
        self.clear_overlay();
        self.rebuild_index();
    }

    pub(crate) fn rebuild_index(&mut self) {
        self.id_to_index.clear();
        self.geohash_index.clear();
        if let Some(ref b) = self.batch {
            let ids = col_id(b);
            let lats = col_lat(b);
            let lngs = col_lng(b);
            for i in 0..b.num_rows() {
                self.id_to_index.insert(ids.value(i), i);
                let gh = encode_geohash(lats.value(i), lngs.value(i));
                self.geohash_index.entry(gh).or_default().push(i);
            }
        }
    }
}

pub type StoreState = Mutex<Store>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

//TODO: seems derivable
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenResult {
    pub location_count: usize,
    pub version: u64,
    pub can_undo: bool,
    pub can_redo: bool,
    pub tag_counts: HashMap<u32, usize>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveResult {
    pub saved_chunks: usize,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SummaryResult {
    pub location_count: usize,
    pub version: u64,
    pub dirty_count: usize,
}

#[derive(serde::Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct RenderDelta {
    pub added: Vec<RenderEntry>,
    pub updated: Vec<RenderPatchEntry>,
    pub removed: Vec<CellRemoval>,
    pub color_patches: Vec<ColorPatchEntry>,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub full_reset: bool,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RenderEntry {
    pub cell: String,
    pub id: u32,
    pub lng: f32,
    pub lat: f32,
    pub heading: f32,
    pub r: u8, pub g: u8, pub b: u8, pub a: u8,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RenderPatchEntry {
    pub cell: String,
    pub cell_index: usize,
    pub lng: Option<f32>,
    pub lat: Option<f32>,
    pub heading: Option<f32>,
}

#[derive(serde::Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CellRemoval {
    pub cell: String,
    pub cell_index: usize,
    pub id: u32,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ColorPatchEntry {
    pub cell: String,
    pub cell_index: usize,
    pub r: u8, pub g: u8, pub b: u8, pub a: u8,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MutationResult {
    pub version: u64,
    pub delta: RenderDelta,
    pub location_count: usize,
    pub can_undo: bool,
    pub can_redo: bool,
    pub tag_counts: HashMap<u32, usize>,
}

/// Deserialize a present-but-null JSON field as `Some(None)` instead of `None`.
/// Missing field → `None` (don't update), `null` → `Some(None)` (set to null),
/// `"value"` → `Some(Some("value"))` (set to value).
fn nullable<'de, T, D>(deserializer: D) -> Result<Option<Option<T>>, D::Error>
where
    T: serde::Deserialize<'de>,
    D: serde::Deserializer<'de>,
{
    use serde::Deserialize;
    Ok(Some(Option::deserialize(deserializer)?))
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocationPatch {
    pub lat: Option<f64>,
    pub lng: Option<f64>,
    pub heading: Option<f64>,
    pub pitch: Option<f64>,
    pub zoom: Option<f64>,
    #[serde(default, deserialize_with = "nullable")]
    pub pano_id: Option<Option<String>>,
    pub flags: Option<u32>,
    pub tags: Option<Vec<u32>>,
    #[serde(default, deserialize_with = "nullable")]
    pub extra: Option<Option<serde_json::Map<String, serde_json::Value>>>,
    pub created_at: Option<String>,
    #[serde(default, deserialize_with = "nullable")]
    pub modified_at: Option<Option<String>>,
}



// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn store_open_map(
    app: tauri::AppHandle,
    state: tauri::State<'_, StoreState>,
    map_id: String,
) -> Result<OpenResult, String> {
    let app2 = app.clone();
    let map_id2 = map_id.clone();

    let result = tokio::task::spawn_blocking(move || {
        use std::time::Instant;
        let t_total = Instant::now();

        let batch = {
            let t0 = Instant::now();
            let path = fast_io::arrow_path(&app2, &map_id2)?;
            let mut batch = if path.exists() {
                fast_io::read_arrow_ipc(&path)?
            } else {
                RecordBatch::new_empty(schema())
            };
            log::debug!("[store_open] arrow_read={}ms rows={}", t0.elapsed().as_millis(), batch.num_rows());

            let delta_path = fast_io::arrow_delta_path(&app2, &map_id2)?;
            if delta_path.exists() {
                let t_d = Instant::now();
                if let Ok(data) = std::fs::read(&delta_path) {
                    if let Ok(delta) = rmp_serde::from_slice::<DeltaOverlay>(&data) {
                        if !delta.dead_ids.is_empty() {
                            let dead_set: HashSet<u32> = delta.dead_ids.into_iter().collect();
                            let ids_col = col_id(&batch);
                            let keep: Vec<u32> = (0..batch.num_rows())
                                .filter(|&i| !dead_set.contains(&ids_col.value(i)))
                                .map(|i| i as u32)
                                .collect();
                            if keep.len() < batch.num_rows() {
                                let take_idx = UInt32Array::from(keep);
                                batch = RecordBatch::try_new(
                                    batch.schema(),
                                    batch.columns().iter().map(|col| {
                                        arrow::compute::take(col.as_ref(), &take_idx, None).unwrap()
                                    }).collect(),
                                ).unwrap();
                            }
                        }
                        if !delta.patches.is_empty() {
                            let patch_map: HashMap<u32, &LocationData> = delta.patches.iter().map(|l| (l.id, l)).collect();
                            let all: Vec<LocationData> = {
                                let ids_col = col_id(&batch);
                                (0..batch.num_rows()).map(|i| {
                                    let id = ids_col.value(i);
                                    if let Some(&patched) = patch_map.get(&id) { patched.clone() }
                                    else { arrow_bridge::row_to_location(&batch, i) }
                                }).collect()
                            };
                            batch = arrow_bridge::locations_to_batch(&all);
                        }
                        if !delta.adds.is_empty() {
                            let add_batch = arrow_bridge::locations_to_batch(&delta.adds);
                            batch = concat_batches(&schema(), &[batch, add_batch]).map_err(|e| e.to_string())?;
                        }
                        // Checkpoint: write merged batch to Arrow IPC so the delta can be discarded
                        let checkpoint_path = fast_io::arrow_path(&app2, &map_id2)?;
                        fast_io::write_arrow_ipc(&checkpoint_path, &batch)?;
                        let _ = std::fs::remove_file(&delta_path);
                        log::debug!("[store_open] delta checkpointed to Arrow IPC");
                    } else {
                        log::warn!("[store_open] delta deserialization failed, delta file preserved");
                    }
                }
                log::debug!("[store_open] delta_merge={}ms rows={}", t_d.elapsed().as_millis(), batch.num_rows());
            }
            batch
        };

        let t3 = Instant::now();
        let ids = col_id(&batch);
        let lats = col_lat(&batch);
        let lngs = col_lng(&batch);
        let n = batch.num_rows();
        let mut id_to_index: HashMap<u32, usize> = HashMap::with_capacity(n);
        let mut geohash_index: HashMap<String, Vec<usize>> = HashMap::new();
        let mut max_id: u32 = 0;
        for i in 0..n {
            let id = ids.value(i);
            id_to_index.insert(id, i);
            if id > max_id { max_id = id; }
            let gh = encode_geohash(lats.value(i), lngs.value(i));
            geohash_index.entry(gh).or_default().push(i);
        }
        log::debug!("[store_open] index_build={}ms", t3.elapsed().as_millis());

        let (undo, redo) = load_edit_history_inner(&app2, &map_id2)?;

        log::debug!("[store_open] TOTAL={}ms", t_total.elapsed().as_millis());
        Ok::<_, String>((batch, id_to_index, geohash_index, max_id, undo, redo))
    })
    .await
    .map_err(|e| e.to_string())??;

    let (batch, id_to_index, geohash_index, max_id, undo, redo) = result;

    let mut store = state.lock().map_err(|e| e.to_string())?;
    let count = batch.num_rows();
    let version = store.bump();
    store.map_id = Some(map_id.clone());
    store.next_id = max_id + 1;
    // Build tag counts from batch
    let mut tc: HashMap<u32, usize> = HashMap::new();
    let mut max_tag_id: u32 = 0;
    {
        let b = &batch;
        let tags_col = col_tags(b);
        for i in 0..b.num_rows() {
            let list = tags_col.value(i);
            let ids = list.as_any().downcast_ref::<UInt32Array>().unwrap();
            for j in 0..ids.len() {
                let tid = ids.value(j);
                *tc.entry(tid).or_default() += 1;
                if tid > max_tag_id { max_tag_id = tid; }
            }
        }
    }
    store.batch = Some(batch);
    store.clear_overlay();
    store.alive_count = count;
    store.tag_counts = tc;
    store.next_tag_id = {
        let conn = fast_io::open_db(&app)?;
        conn.execute("UPDATE maps SET location_count = ?1 WHERE id = ?2",
            rusqlite::params![count, map_id]).map_err(|e| e.to_string())?;
        let tags = read_tags_json(&conn, &map_id);
        tags.keys().max().copied().unwrap_or(0) + 1
    };
    store.id_to_index = id_to_index;
    store.geohash_index = geohash_index;
    store.dirty_geohashes.clear();
    store.committed_blobs.clear();
    store.selections.clear();
    store.selected_ids.clear();
    store.selected_colors.clear();
    store.active_id = None;
    store.selection_version += 1;
    store.undo_stack = undo;
    store.redo_stack = redo;

    Ok(OpenResult {
        location_count: count,
        version,
        can_undo: !store.undo_stack.is_empty(),
        can_redo: !store.redo_stack.is_empty(),
        tag_counts: store.tag_counts.clone(),
    })
}

#[tauri::command]
pub fn store_close_map(
    app: tauri::AppHandle,
    state: tauri::State<'_, StoreState>,
) -> Result<(), String> {
    let mut store = state.lock().map_err(|e| e.to_string())?;
    if let Some(ref map_id) = store.map_id.clone() {
        if store.dirty {
            store.bake_overlay();
            if let Some(ref batch) = store.batch {
                let path = fast_io::arrow_path(&app, map_id)?;
                fast_io::write_arrow_ipc(&path, batch)?;
            }
            let delta_path = fast_io::arrow_delta_path(&app, map_id)?;
            let _ = std::fs::remove_file(delta_path);
        }
        let count = store.alive_count;
        let conn = fast_io::open_db(&app)?;
        conn.execute("UPDATE maps SET location_count = ?1 WHERE id = ?2", rusqlite::params![count, map_id])
            .map_err(|e| e.to_string())?;
        save_edit_history_inner(&app, map_id, &store.undo_stack, &store.redo_stack)?;
    }
    store.map_id = None;
    store.batch = None;
    store.clear_overlay();
    store.alive_count = 0;
    store.id_to_index.clear();
    store.geohash_index.clear();
    store.dirty_geohashes.clear();
    store.render_cells.clear();
    store.id_to_cell.clear();
    store.selected_ids.clear();
    store.selected_colors.clear();
    store.active_id = None;
    store.undo_stack.clear();
    store.redo_stack.clear();
    Ok(())
}

#[tauri::command]
pub fn store_add_locations(
    state: tauri::State<'_, StoreState>,
    mut locations: Vec<LocationData>,
) -> Result<MutationResult, String> {
    let _t = std::time::Instant::now();
    let mut store = state.lock().map_err(|e| e.to_string())?;
    let _lock = _t.elapsed().as_millis();
    // Assign IDs from the store's allocator
    for loc in &mut locations {
        loc.id = store.alloc_id();
    }
    store.push_undo(EditEntry { created: locations.clone(), removed: Vec::new() });
    store.redo_stack.clear();
    let mut added = Vec::with_capacity(locations.len());
    for loc in &locations {
        store.mark_dirty(loc.lat, loc.lng);
        let gh = encode_geohash(loc.lat, loc.lng);
        let cell = render_cell_key(&gh).to_string();
        store.cell_add_render(&cell, loc.id);
        added.push(RenderEntry {
            cell,
            id: loc.id,
            lng: loc.lng as f32, lat: loc.lat as f32, heading: loc.heading as f32,
            r: 42, g: 42, b: 42, a: 255,
        });
    }
    store.add_tag_counts(&locations);
    for loc in locations {
        store.overlay_add(loc);
    }
    log::debug!("[cmd] store_add_locations lock={}ms total={}ms", _lock, _t.elapsed().as_millis());
    Ok(store.finish_mutation(RenderDelta { added, ..Default::default() }))
}

#[tauri::command]
pub fn store_remove_locations(
    state: tauri::State<'_, StoreState>,
    ids: Vec<u32>,
) -> Result<MutationResult, String> {
    let _t = std::time::Instant::now();
    let mut store = state.lock().map_err(|e| e.to_string())?;
    let mut removed_locs = Vec::new();
    let mut removals = Vec::new();
    for &id in &ids {
        if let Some(loc) = store.get_loc_by_id(id) {
            removed_locs.push(loc);
        }
    }
    store.remove_tag_counts(&removed_locs);
    store.overlay_remove(&removed_locs);

    for &id in &ids {
        if let Some(removal) = store.cell_remove_render(id) {
            removals.push(removal);
        }
    }
    store.push_undo(EditEntry { created: Vec::new(), removed: removed_locs });
    store.redo_stack.clear();

    log::debug!("[cmd] store_remove_locations total={}ms ids={}", _t.elapsed().as_millis(), ids.len());
    Ok(store.finish_mutation(RenderDelta { removed: removals, ..Default::default() }))
}

fn build_update_delta(store: &mut Store, id: u32, new_loc: &LocationData, patch: &LocationPatch) -> RenderDelta {
    let mut delta = RenderDelta::default();
    let pos_changed = patch.lat.is_some() || patch.lng.is_some();
    let heading_changed = patch.heading.is_some();

    if pos_changed {
        let gh = encode_geohash(new_loc.lat, new_loc.lng);
        let new_cell = render_cell_key(&gh).to_string();
        let old_cell = store.id_to_cell.get(&id).cloned();
        if old_cell.as_deref() != Some(new_cell.as_str()) {
            if let Some(removal) = store.cell_remove_render(id) {
                delta.removed.push(removal);
            }
            store.cell_add_render(&new_cell, id);
            delta.added.push(RenderEntry {
                cell: new_cell,
                id,
                lng: new_loc.lng as f32, lat: new_loc.lat as f32, heading: new_loc.heading as f32,
                r: 42, g: 42, b: 42, a: 255,
            });
            return delta;
        }
    }

    if let Some((cell, ci)) = store.cell_lookup(id) {
        if pos_changed || heading_changed {
            delta.updated.push(RenderPatchEntry {
                cell,
                cell_index: ci,
                lng: if pos_changed { Some(new_loc.lng as f32) } else { None },
                lat: if pos_changed { Some(new_loc.lat as f32) } else { None },
                heading: if heading_changed { Some(new_loc.heading as f32) } else { None },
            });
        }
    }
    delta
}

#[tauri::command]
pub fn store_update_locations(
    state: tauri::State<'_, StoreState>,
    updates: Vec<(u32, LocationPatch)>,
    record_undo: Option<bool>,
) -> Result<MutationResult, String> {
    let record_undo = record_undo.unwrap_or(true);
    let _t = std::time::Instant::now();
    let mut store = state.lock().map_err(|e| e.to_string())?;
    let mut old_locs = Vec::new();
    let mut new_locs = Vec::new();
    let mut delta = RenderDelta::default();
    let any_tags = updates.iter().any(|(_, p)| p.tags.is_some());
    for (id, patch) in &updates {
        if let Some(old) = store.get_loc_by_id(*id) {
            old_locs.push(old);
            store.overlay_update(*id, patch);
            let new_loc = store.get_loc_by_id(*id).unwrap();
            new_locs.push(new_loc.clone());
            let d = build_update_delta(&mut store, *id, &new_loc, patch);
            delta.added.extend(d.added);
            delta.removed.extend(d.removed);
            delta.updated.extend(d.updated);
        }
    }
    if any_tags {
        store.remove_tag_counts(&old_locs);
        store.add_tag_counts(&new_locs);
    }
    if record_undo {
        let (changed_old, changed_new): (Vec<_>, Vec<_>) = old_locs.into_iter()
            .zip(new_locs)
            .filter(|(o, n)| o != n)
            .unzip();
        if !changed_old.is_empty() {
            store.push_undo(EditEntry { created: changed_new, removed: changed_old });
            store.redo_stack.clear();
        }
    }
    log::debug!("[cmd] store_update_locations n={} undo={} total={}ms", updates.len(), record_undo, _t.elapsed().as_millis());
    Ok(store.finish_mutation(delta))
}

#[tauri::command]
pub fn store_set_active(
    state: tauri::State<'_, StoreState>,
    id: Option<u32>,
) -> Result<(), String> {
    let mut store = state.lock().map_err(|e| e.to_string())?;
    store.active_id = id;
    Ok(())
}

#[tauri::command]
pub fn store_get_location(
    state: tauri::State<'_, StoreState>,
    id: u32,
) -> Result<LocationData, String> {
    let _t = std::time::Instant::now();
    let store = state.lock().map_err(|e| e.to_string())?;
    let r = store.get_loc_by_id(id).ok_or_else(|| "location not found".to_string());
    log::debug!("[cmd] store_get_location lock={}ms total={}ms", _t.elapsed().as_millis(), _t.elapsed().as_millis());
    r
}

#[tauri::command]
pub fn store_get_locations_by_ids(
    state: tauri::State<'_, StoreState>,
    ids: Vec<u32>,
) -> Result<Vec<LocationData>, String> {
    let store = state.lock().map_err(|e| e.to_string())?;
    let mut result = Vec::with_capacity(ids.len());
    for &id in &ids {
        if let Some(loc) = store.get_loc_by_id(id) {
            result.push(loc);
        }
    }
    Ok(result)
}

#[tauri::command]
pub fn store_get_all_locations(
    app: tauri::AppHandle,
    state: tauri::State<'_, StoreState>,
) -> Result<String, String> {
    let store = state.lock().map_err(|e| e.to_string())?;
    let locs = store.collect_all_locations();
    let json = serde_json::to_vec(&locs).map_err(|e| e.to_string())?;
    let path = app.path().temp_dir().map_err(|e| e.to_string())?
        .join("mma_all_locations.json");
    std::fs::write(&path, &json).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().into_owned())
}

#[derive(serde::Serialize, serde::Deserialize)]
struct DeltaOverlay {
    adds: Vec<LocationData>,
    dead_ids: Vec<u32>,
    patches: Vec<LocationData>,
}

#[tauri::command]
pub async fn store_save_dirty(
    app: tauri::AppHandle,
    state: tauri::State<'_, StoreState>,
) -> Result<SaveResult, String> {
    let _t = std::time::Instant::now();
    log::debug!("[cmd] store_save_dirty ENTER");
    let (map_id, delta_data, alive, undo_bytes, redo_bytes) = {
        let store = state.lock().map_err(|e| e.to_string())?;
        let map_id = store.map_id.clone().ok_or("no map open")?;
        if !store.dirty {
            return Ok(SaveResult { saved_chunks: 0 });
        }
        let overlay = DeltaOverlay {
            adds: store.overlay_adds.clone(),
            dead_ids: store.overlay_dead.iter().cloned().collect(),
            patches: store.overlay_patches.values().cloned().collect(),
        };
        let data = rmp_serde::to_vec_named(&overlay).map_err(|e| e.to_string())?;
        let ub = rmp_serde::to_vec_named(&store.undo_stack).unwrap_or_default();
        let rb = rmp_serde::to_vec_named(&store.redo_stack).unwrap_or_default();
        (map_id, data, store.alive_count, ub, rb)
    };

    let size = delta_data.len();
    let app2 = app.clone();
    let map_id2 = map_id.clone();
    tokio::task::spawn_blocking(move || {
        let path = fast_io::arrow_delta_path(&app2, &map_id2)?;
        fast_io::atomic_write(&path, |mut file| {
            use std::io::Write;
            file.write_all(&delta_data).map_err(|e| e.to_string())
        })?;
        let conn = fast_io::open_db(&app2)?;
        conn.execute("UPDATE maps SET location_count = ?1 WHERE id = ?2",
            rusqlite::params![alive, &map_id2]).map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT OR REPLACE INTO edit_history (map_id, undo_stack, redo_stack) VALUES (?1, ?2, ?3)",
            rusqlite::params![map_id2, undo_bytes, redo_bytes],
        ).map_err(|e| e.to_string())?;
        Ok::<_, String>(())
    })
    .await
    .map_err(|e| e.to_string())??;

    log::debug!("[cmd] store_save_dirty total={}ms size={}", _t.elapsed().as_millis(), size);
    Ok(SaveResult { saved_chunks: size })
}

#[tauri::command]
pub fn store_get_summary(
    state: tauri::State<'_, StoreState>,
) -> Result<SummaryResult, String> {
    let _t = std::time::Instant::now();
    let store = state.lock().map_err(|e| e.to_string())?;
    let count = store.alive_count;
    log::debug!("[cmd] store_get_summary total={}ms alive_count={}", _t.elapsed().as_millis(), count);
    Ok(SummaryResult {
        location_count: count,
        version: store.version,
        dirty_count: if store.dirty { 1 } else { 0 },
    })
}

fn save_edit_history_inner(app: &tauri::AppHandle, map_id: &str, undo: &[EditEntry], redo: &[EditEntry]) -> Result<(), String> {
    let conn = fast_io::open_db(app)?;
    let undo_capped = if undo.len() > MAX_UNDO_ENTRIES { &undo[undo.len() - MAX_UNDO_ENTRIES..] } else { undo };
    let redo_capped = if redo.len() > MAX_UNDO_ENTRIES { &redo[redo.len() - MAX_UNDO_ENTRIES..] } else { redo };
    let undo_bytes = rmp_serde::to_vec_named(undo_capped).map_err(|e| e.to_string())?;
    let redo_bytes = rmp_serde::to_vec_named(redo_capped).map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT OR REPLACE INTO edit_history (map_id, undo_stack, redo_stack) VALUES (?1, ?2, ?3)",
        rusqlite::params![map_id, undo_bytes, redo_bytes],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

fn load_edit_history_inner(app: &tauri::AppHandle, map_id: &str) -> Result<(Vec<EditEntry>, Vec<EditEntry>), String> {
    let conn = fast_io::open_db(app)?;
    let result = conn.query_row(
        "SELECT undo_stack, redo_stack FROM edit_history WHERE map_id = ?1",
        [map_id],
        |row| Ok((row.get::<_, Vec<u8>>(0)?, row.get::<_, Vec<u8>>(1)?)),
    );
    match result {
        Ok((undo_bytes, redo_bytes)) => {
            let undo: Vec<EditEntry> = rmp_serde::from_slice(&undo_bytes).unwrap_or_default();
            let redo: Vec<EditEntry> = rmp_serde::from_slice(&redo_bytes).unwrap_or_default();
            Ok((undo, redo))
        }
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok((Vec::new(), Vec::new())),
        Err(e) => Err(e.to_string()),
    }
}

fn save_arrow_inner(store: &Store, app: &tauri::AppHandle, map_id: &str) -> Result<(), String> {
    if let Some(ref batch) = store.batch {
        let path = fast_io::arrow_path(app, map_id)?;
        fast_io::write_arrow_ipc(&path, batch)?;
        let delta = fast_io::arrow_delta_path(app, map_id)?;
        let _ = std::fs::remove_file(delta);
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// VCS: snapshot / restore Arrow files
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn store_bake_and_save(
    app: tauri::AppHandle,
    state: tauri::State<'_, StoreState>,
) -> Result<(), String> {
    let mut store = state.lock().map_err(|e| e.to_string())?;
    let map_id = store.map_id.clone().ok_or("no map open")?;
    store.bake_overlay();
    save_arrow_inner(&store, &app, &map_id)?;
    let count = store.batch.as_ref().map_or(0, |b| b.num_rows());
    let conn = fast_io::open_db(&app)?;
    conn.execute("UPDATE maps SET location_count = ?1 WHERE id = ?2", rusqlite::params![count, map_id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[derive(serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitBlobEntry {
    pub geohash: String,
    pub blob_hash: String,
    pub location_count: u32,
}

#[tauri::command]
pub fn store_snapshot_commit(
    app: tauri::AppHandle,
    state: tauri::State<'_, StoreState>,
) -> Result<Vec<CommitBlobEntry>, String> {
    let _t = std::time::Instant::now();
    let mut store = state.lock().map_err(|e| e.to_string())?;
    store.map_id.as_ref().ok_or("no map open")?;
    let batch = store.batch.as_ref().ok_or("no data loaded")?;
    if batch.num_rows() == 0 {
        store.committed_blobs.clear();
        store.dirty_geohashes.clear();
        return Ok(Vec::new());
    }

    let first_commit = store.committed_blobs.is_empty();
    let dirty = &store.dirty_geohashes;
    let stale_count: u32 = store.committed_blobs.values().map(|(_, c)| c).sum();
    log::debug!("[snapshot] first_commit={} batch_rows={} committed_blobs_count={} stale_loc_count={}",
        first_commit, batch.num_rows(), store.committed_blobs.len(), stale_count);

    if first_commit {
        let lats = col_lat(batch);
        let lngs = col_lng(batch);
        let schema = batch.schema();

        let mut gh_indices: HashMap<String, Vec<u32>> = HashMap::new();
        for i in 0..batch.num_rows() {
            let gh = encode_geohash(lats.value(i), lngs.value(i));
            gh_indices.entry(gh).or_default().push(i as u32);
        }

        let mut entries = Vec::with_capacity(gh_indices.len());
        for (gh, indices) in &gh_indices {
            let take_idx = arrow::array::UInt32Array::from(indices.clone());
            let columns: Vec<ArrayRef> = batch.columns().iter().map(|col| {
                arrow::compute::take(col.as_ref(), &take_idx, None).unwrap()
            }).collect();
            let cell_batch = RecordBatch::try_new(schema.clone(), columns).unwrap();
            let (hash, count) = fast_io::write_blob(&app, &cell_batch)
                .expect("blob write failed");
            entries.push(CommitBlobEntry {
                geohash: gh.clone(),
                blob_hash: hash,
                location_count: count as u32,
            });
        }

        store.committed_blobs = entries.iter()
            .map(|e| (e.geohash.clone(), (e.blob_hash.clone(), e.location_count)))
            .collect();
        store.dirty_geohashes.clear();
        log::debug!("[cmd] store_snapshot_commit (full) total={}ms cells={}", _t.elapsed().as_millis(), entries.len());
        Ok(entries)
    } else {
        let dirty_cells: Vec<String> = dirty.iter().cloned().collect();
        let schema = batch.schema();

        let mut dirty_entries = Vec::new();
        for gh in &dirty_cells {
            let indices: Vec<u32> = match store.geohash_index.get(gh) {
                Some(v) => v.iter().map(|&i| i as u32).collect(),
                None => continue,
            };
            if indices.is_empty() { continue; }
            let take_idx = arrow::array::UInt32Array::from(indices);
            let columns: Vec<ArrayRef> = batch.columns().iter().map(|col| {
                arrow::compute::take(col.as_ref(), &take_idx, None).unwrap()
            }).collect();
            let cell_batch = RecordBatch::try_new(schema.clone(), columns).unwrap();
            let (hash, count) = fast_io::write_blob(&app, &cell_batch)
                .expect("blob write failed");
            dirty_entries.push(CommitBlobEntry {
                geohash: gh.clone(),
                blob_hash: hash,
                location_count: count as u32,
            });
        }

        for entry in &dirty_entries {
            store.committed_blobs.insert(
                entry.geohash.clone(),
                (entry.blob_hash.clone(), entry.location_count),
            );
        }
        for gh in &dirty_cells {
            if !store.geohash_index.contains_key(gh) {
                store.committed_blobs.remove(gh);
            }
        }
        store.dirty_geohashes.clear();

        let entries: Vec<CommitBlobEntry> = store.committed_blobs.iter()
            .map(|(gh, (hash, count))| CommitBlobEntry {
                geohash: gh.clone(),
                blob_hash: hash.clone(),
                location_count: *count,
            })
            .collect();

        log::debug!("[cmd] store_snapshot_commit (incremental) total={}ms dirty={} total_cells={}",
            _t.elapsed().as_millis(), dirty_cells.len(), entries.len());
        Ok(entries)
    }
}

#[tauri::command]
pub fn store_restore_commit(
    app: tauri::AppHandle,
    map_id: String,
    blobs: Vec<CommitBlobEntry>,
) -> Result<(), String> {
    let _t = std::time::Instant::now();
    let s = schema();
    let batches: Result<Vec<RecordBatch>, String> = blobs
        .par_iter()
        .map(|entry| fast_io::read_blob(&app, &entry.blob_hash))
        .collect();
    let batches = batches?;
    let batch = if batches.is_empty() {
        RecordBatch::new_empty(s)
    } else {
        concat_batches(&s, &batches).map_err(|e| e.to_string())?
    };
    let path = fast_io::arrow_path(&app, &map_id)?;
    fast_io::write_arrow_ipc(&path, &batch)?;
    let delta = fast_io::arrow_delta_path(&app, &map_id)?;
    let _ = std::fs::remove_file(delta);
    log::debug!("[cmd] store_restore_commit total={}ms rows={}", _t.elapsed().as_millis(), batch.num_rows());
    Ok(())
}

// ---------------------------------------------------------------------------
// Render buffer
// ---------------------------------------------------------------------------

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenderRequest {
    pub west: f64, pub south: f64, pub east: f64, pub north: f64,
    pub selected_ids: Option<Vec<u32>>,
    pub marker_style: String,
}

fn build_cell_render_buffers(store: &mut Store, req: &RenderRequest) -> Vec<u8> {
    let _t = std::time::Instant::now();
    let b = match &store.batch {
        Some(b) => b,
        None if store.overlay_adds.is_empty() => return Vec::new(),
        None => {
            let empty = arrow_bridge::locations_to_batch(&[]);
            store.batch = Some(empty);
            store.batch.as_ref().unwrap()
        }
    };
    let batch_n = b.num_rows();
    let lats = col_lat(b);
    let lngs = col_lng(b);
    let ids_col = col_id(b);
    let headings = col_heading(b);
    let has_dead = !store.overlay_dead.is_empty();
    let has_patches = !store.overlay_patches.is_empty();

    let selected_set: &HashSet<u32> = &store.selected_ids;
    let active_id = store.active_id;
    let arrow_style = req.marker_style == "arrow";

    // 32 cells indexed by render_cell_idx (0-31)
    struct CellOut { ids: Vec<u32>, positions: Vec<f32>, colors: Vec<u8>, angles: Vec<f32> }
    const NONE: Option<CellOut> = None;
    let mut cells: [Option<CellOut>; 32] = [NONE; 32];

    // Selection overlay: selected entries rendered as a separate colored layer
    let sel_colors = &store.selected_colors;
    struct SelOverlay { ids: Vec<u32>, positions: Vec<f32>, colors: Vec<u8>, angles: Vec<f32> }
    let mut sel_ov = SelOverlay { ids: Vec::new(), positions: Vec::new(), colors: Vec::new(), angles: Vec::new() };

    // Single linear pass over batch rows (cache-friendly)
    for i in 0..batch_n {
        let id = ids_col.value(i);
        if has_dead && store.overlay_dead.contains(&id) { continue; }
        let (lat, lng, heading) = if has_patches {
            if let Some(p) = store.overlay_patches.get(&id) {
                (p.lat, p.lng, p.heading)
            } else {
                (lats.value(i), lngs.value(i), headings.value(i))
            }
        } else {
            (lats.value(i), lngs.value(i), headings.value(i))
        };
        let ci = render_cell_idx(lat, lng) as usize;
        let out = cells[ci].get_or_insert_with(|| CellOut {
            ids: Vec::new(), positions: Vec::new(), colors: Vec::new(), angles: Vec::new(),
        });
        out.positions.push(lng as f32);
        out.positions.push(lat as f32);
        let angle = if arrow_style { 180.0 - heading as f32 } else { 0.0 };
        let is_hidden = selected_set.contains(&id) || active_id == Some(id);
        if is_hidden { out.colors.extend_from_slice(&[0, 0, 0, 0]); }
        else { out.colors.extend_from_slice(&[42, 42, 42, 255]); }
        out.angles.push(angle);
        out.ids.push(id);
        if let Some(&[r, g, b]) = sel_colors.get(&id) {
            sel_ov.positions.push(lng as f32);
            sel_ov.positions.push(lat as f32);
            sel_ov.colors.extend_from_slice(&[r, g, b, 255]);
            sel_ov.angles.push(angle);
            sel_ov.ids.push(id);
        }
    }
    // Overlay adds
    for loc in &store.overlay_adds {
        let ci = render_cell_idx(loc.lat, loc.lng) as usize;
        let out = cells[ci].get_or_insert_with(|| CellOut {
            ids: Vec::new(), positions: Vec::new(), colors: Vec::new(), angles: Vec::new(),
        });
        let id = loc.id;
        let is_hidden = selected_set.contains(&id) || active_id == Some(id);
        out.positions.push(loc.lng as f32);
        out.positions.push(loc.lat as f32);
        let angle = if arrow_style { 180.0 - loc.heading as f32 } else { 0.0 };
        if is_hidden { out.colors.extend_from_slice(&[0, 0, 0, 0]); }
        else { out.colors.extend_from_slice(&[42, 42, 42, 255]); }
        out.angles.push(angle);
        out.ids.push(id);
        if let Some(&[r, g, b]) = sel_colors.get(&id) {
            sel_ov.positions.push(loc.lng as f32);
            sel_ov.positions.push(loc.lat as f32);
            sel_ov.colors.extend_from_slice(&[r, g, b, 255]);
            sel_ov.angles.push(angle);
            sel_ov.ids.push(id);
        }
    }

    // Rebuild per-cell render tracking
    store.render_cells.clear();
    store.id_to_cell.clear();
    let mut total_count = 0usize;
    let mut non_empty = 0u32;
    for ci in 0..32 {
        let out = match &cells[ci] { Some(o) => o, None => continue };
        let key = cell_key_from_idx(ci as u8);
        let mut cr = CellRender { id_order: Vec::with_capacity(out.ids.len()), id_to_index: HashMap::new() };
        for (i, &id) in out.ids.iter().enumerate() {
            cr.id_to_index.insert(id, i);
            cr.id_order.push(id);
            store.id_to_cell.insert(id, key.clone());
        }
        total_count += out.ids.len();
        non_empty += 1;
        store.render_cells.insert(key, cr);
    }

    // Serialize: u32 cell_count, per cell: [1 byte geohash char][u32 count][positions][colors][angles]
    let mut buf = Vec::new();
    buf.extend_from_slice(&non_empty.to_le_bytes());
    for ci in 0..32 {
        let out = match &cells[ci] { Some(o) => o, None => continue };
        let count = out.ids.len() as u32;
        buf.push(BASE32[ci]);
        buf.extend_from_slice(&count.to_le_bytes());
        for &id in &out.ids { buf.extend_from_slice(&id.to_le_bytes()); }
        for &v in &out.positions { buf.extend_from_slice(&v.to_le_bytes()); }
        buf.extend_from_slice(&out.colors);
        for &v in &out.angles { buf.extend_from_slice(&v.to_le_bytes()); }
    }

    // Selection overlay: [u32 count][f32[] positions][u8[] colors][f32[] angles][u32[] ids]
    let sel_count = sel_ov.ids.len() as u32;
    buf.extend_from_slice(&sel_count.to_le_bytes());
    if sel_count > 0 {
        for &v in &sel_ov.positions { buf.extend_from_slice(&v.to_le_bytes()); }
        buf.extend_from_slice(&sel_ov.colors);
        for &v in &sel_ov.angles { buf.extend_from_slice(&v.to_le_bytes()); }
        for &id in &sel_ov.ids { buf.extend_from_slice(&id.to_le_bytes()); }
    }

    log::debug!("[cmd] build_cell_render_buffers total={}ms cells={} points={} sel_overlay={} bytes={}",
        _t.elapsed().as_millis(), non_empty, total_count, sel_count, buf.len());
    buf
}

#[tauri::command]
pub fn store_fill_render_attrs(
    state: tauri::State<'_, StoreState>,
    req: RenderRequest,
) -> Result<Response, String> {
    let mut store = state.lock().map_err(|e| e.to_string())?;
    let buf = build_cell_render_buffers(&mut store, &req);
    Ok(Response::new(buf))
}

#[tauri::command]
pub async fn store_fill_render_file(
    app: tauri::AppHandle,
    state: tauri::State<'_, StoreState>,
    req: RenderRequest,
) -> Result<String, String> {
    log::debug!("[cmd] store_fill_render_file ENTER");
    let buf = {
        let mut store = state.lock().map_err(|e| e.to_string())?;
        build_cell_render_buffers(&mut store, &req)
    };
    let path = app.path().temp_dir().map_err(|e| e.to_string())?
        .join("mma_render_buffer.bin");
    tokio::task::spawn_blocking(move || {
        std::fs::write(&path, &buf).map_err(|e| e.to_string())?;
        Ok(path.to_string_lossy().into_owned())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn store_resolve_pick(
    state: tauri::State<'_, StoreState>,
    cell: String,
    cell_index: usize,
) -> Result<Option<u32>, String> {
    let store = state.lock().map_err(|e| e.to_string())?;
    Ok(store.render_cells.get(&cell)
        .and_then(|cr| cr.id_order.get(cell_index).copied()))
}

// ---------------------------------------------------------------------------
// Undo / Redo
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn store_undo(state: tauri::State<'_, StoreState>) -> Result<MutationResult, String> {
    let mut store = state.lock().map_err(|e| e.to_string())?;
    let _t = std::time::Instant::now();
    let entry = store.undo_stack.pop().ok_or("nothing to undo")?;
    log::debug!("[UNDO] stack_depth={} created={} removed={}",
        store.undo_stack.len(), entry.created.len(), entry.removed.len());
    let delta = apply_edit_reverse(&mut store, &entry);
    log::debug!("[UNDO] apply_edit={}ms delta: +{} -{}", _t.elapsed().as_millis(), delta.added.len(), delta.removed.len());
    store.redo_stack.push(entry);
    Ok(store.finish_mutation(delta))
}

#[tauri::command]
pub fn store_redo(state: tauri::State<'_, StoreState>) -> Result<MutationResult, String> {
    let mut store = state.lock().map_err(|e| e.to_string())?;
    let _t = std::time::Instant::now();
    let entry = store.redo_stack.pop().ok_or("nothing to redo")?;
    log::debug!("[REDO] stack_depth={} created={} removed={}",
        store.redo_stack.len(), entry.created.len(), entry.removed.len());
    let delta = apply_edit_forward(&mut store, &entry);
    log::debug!("[REDO] apply_edit={}ms delta: +{} -{}", _t.elapsed().as_millis(), delta.added.len(), delta.removed.len());
    store.push_undo(entry);
    Ok(store.finish_mutation(delta))
}

#[tauri::command]
pub fn store_commit_diff(state: tauri::State<'_, StoreState>) -> Result<(u32, u32, u32), String> {
    let store = state.lock().map_err(|e| e.to_string())?;
    let mut added = HashSet::new();
    let mut removed = HashSet::new();
    let mut modified = HashSet::new();
    for entry in &store.undo_stack {
        for loc in &entry.removed {
            if added.remove(&loc.id) { modified.remove(&loc.id); }
            else { removed.insert(&loc.id); }
        }
        for loc in &entry.created {
            if removed.remove(&loc.id) { modified.insert(&loc.id); }
            else if !added.contains(&loc.id) && !modified.contains(&loc.id) { added.insert(&loc.id); }
        }
    }
    Ok((added.len() as u32, removed.len() as u32, modified.len() as u32))
}

#[tauri::command]
pub fn store_reset_undo(state: tauri::State<'_, StoreState>) -> Result<(), String> {
    let mut store = state.lock().map_err(|e| e.to_string())?;
    store.undo_stack.clear();
    store.redo_stack.clear();
    Ok(())
}

#[tauri::command]
pub fn store_can_undo_redo(state: tauri::State<'_, StoreState>) -> Result<(bool, bool), String> {
    let store = state.lock().map_err(|e| e.to_string())?;
    Ok((!store.undo_stack.is_empty(), !store.redo_stack.is_empty()))
}

fn apply_edit(store: &mut Store, remove: &[LocationData], create: &[LocationData]) -> RenderDelta {
    let t0 = std::time::Instant::now();
    let mut delta = RenderDelta::default();
    let remove_ids: HashSet<u32> = remove.iter().map(|l| l.id).collect();
    let create_ids: HashSet<u32> = create.iter().map(|l| l.id).collect();
    let t1 = t0.elapsed();

    store.remove_tag_counts(remove);
    let t2 = t0.elapsed();

    store.overlay_remove(remove);
    let t3 = t0.elapsed();

    for id in &remove_ids {
        if !create_ids.contains(id) {
            if let Some(removal) = store.cell_remove_render(*id) {
                delta.removed.push(removal);
            }
        }
    }
    let t4 = t0.elapsed();

    let remove_by_id: HashMap<u32, &LocationData> = remove.iter().map(|l| (l.id, l)).collect();

    store.add_tag_counts(create);
    for loc in create {
        store.overlay_add(loc.clone());

        if remove_ids.contains(&loc.id) {
            let render_changed = remove_by_id.get(&loc.id).map_or(true, |o|
                o.lat != loc.lat || o.lng != loc.lng || o.heading != loc.heading
            );
            if render_changed {
                if let Some(removal) = store.cell_remove_render(loc.id) {
                    delta.removed.push(removal);
                }
                let gh = encode_geohash(loc.lat, loc.lng);
                let cell = render_cell_key(&gh).to_string();
                let is_selected = store.selected_ids.contains(&loc.id);
                let (r, g, b, a) = if is_selected { (0, 0, 0, 0) } else { (42, 42, 42, 255) };
                store.cell_add_render(&cell, loc.id);
                delta.added.push(RenderEntry {
                    cell, id: loc.id,
                    lng: loc.lng as f32, lat: loc.lat as f32, heading: loc.heading as f32,
                    r, g, b, a,
                });
            }
        } else {
            let gh = encode_geohash(loc.lat, loc.lng);
            let cell = render_cell_key(&gh).to_string();
            let is_selected = store.selected_ids.contains(&loc.id);
            let (r, g, b, a) = if is_selected { (0, 0, 0, 0) } else { (42, 42, 42, 255) };
            store.cell_add_render(&cell, loc.id);
            delta.added.push(RenderEntry {
                cell, id: loc.id,
                lng: loc.lng as f32, lat: loc.lat as f32, heading: loc.heading as f32,
                r, g, b, a,
            });
        }
    }
    let t5 = t0.elapsed();

    log::debug!("[apply_edit] hashsets={}ms tags_rm={}ms overlay_rm={}ms cell_rm={}ms create={}ms total={}ms",
        t1.as_millis(), (t2-t1).as_millis(), (t3-t2).as_millis(), (t4-t3).as_millis(), (t5-t4).as_millis(), t5.as_millis());
    delta
}

fn apply_edit_forward(store: &mut Store, entry: &EditEntry) -> RenderDelta {
    apply_edit(store, &entry.removed, &entry.created)
}

fn apply_edit_reverse(store: &mut Store, entry: &EditEntry) -> RenderDelta {
    apply_edit(store, &entry.created, &entry.removed)
}

// ---------------------------------------------------------------------------
// Query commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn store_tag_counts(state: tauri::State<'_, StoreState>) -> Result<HashMap<u32, usize>, String> {
    let _t = std::time::Instant::now();
    let store = state.lock().map_err(|e| e.to_string())?;
    let r = store.tag_counts.clone();
    log::debug!("[cmd] store_tag_counts total={}ms", _t.elapsed().as_millis());
    Ok(r)
}

#[tauri::command]
pub fn store_alloc_tag_id(state: tauri::State<'_, StoreState>) -> Result<u32, String> {
    let mut store = state.lock().map_err(|e| e.to_string())?;
    let id = store.next_tag_id;
    store.next_tag_id += 1;
    Ok(id)
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedTag {
    pub id: u32,
    pub name: String,
    pub color: String,
    pub created: bool,
}

#[derive(serde::Deserialize, serde::Serialize, Clone)]
struct SqlTagEntry {
    id: u32,
    name: String,
    color: String,
    visible: bool,
    #[serde(default)]
    order: i32,
}

fn read_tags_json(conn: &rusqlite::Connection, map_id: &str) -> HashMap<u32, SqlTagEntry> {
    let json: String = conn.query_row(
        "SELECT tags FROM maps WHERE id = ?1", [map_id], |row| row.get(0),
    ).unwrap_or_else(|_| "{}".into());
    let raw: HashMap<String, SqlTagEntry> = serde_json::from_str(&json).unwrap_or_default();
    raw.into_iter().filter_map(|(k, v)| k.parse::<u32>().ok().map(|id| (id, v))).collect()
}

fn write_tags_json(conn: &rusqlite::Connection, map_id: &str, tags: &HashMap<u32, SqlTagEntry>) -> Result<(), String> {
    let as_str_keys: HashMap<String, &SqlTagEntry> = tags.iter().map(|(k, v)| (k.to_string(), v)).collect();
    let json = serde_json::to_string(&as_str_keys).map_err(|e| e.to_string())?;
    conn.execute("UPDATE maps SET tags = ?1 WHERE id = ?2", rusqlite::params![json, map_id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn store_resolve_tag_names(
    app: tauri::AppHandle,
    state: tauri::State<'_, StoreState>,
    names: Vec<String>,
) -> Result<Vec<ResolvedTag>, String> {
    let mut store = state.lock().map_err(|e| e.to_string())?;
    let map_id = store.map_id.as_ref().ok_or("no map open")?.clone();

    let conn = fast_io::open_db(&app)?;
    let mut tags = read_tags_json(&conn, &map_id);

    let mut name_to_id: HashMap<String, (u32, String)> = HashMap::new();
    for (id, entry) in &tags {
        name_to_id.insert(entry.name.to_lowercase(), (*id, entry.color.clone()));
    }

    let mut result = Vec::with_capacity(names.len());
    let mut changed = false;

    for name in &names {
        if let Some((id, color)) = name_to_id.get(&name.to_lowercase()) {
            result.push(ResolvedTag { id: *id, name: name.clone(), color: color.clone(), created: false });
        } else {
            let id = store.alloc_tag_id();
            let color = crate::util::color_for_name(name);
            let order = tags.len() as i32;
            tags.insert(id, SqlTagEntry { id, name: name.clone(), color: color.clone(), visible: true, order });
            name_to_id.insert(name.to_lowercase(), (id, color.clone()));
            result.push(ResolvedTag { id, name: name.clone(), color, created: true });
            changed = true;
        }
    }

    if changed {
        write_tags_json(&conn, &map_id, &tags)?;
    }

    Ok(result)
}

#[tauri::command]
pub fn store_bounds(state: tauri::State<'_, StoreState>) -> Result<Option<[f64; 4]>, String> {
    let _t = std::time::Instant::now();
    let store = state.lock().map_err(|e| e.to_string())?;
    if store.batch.is_none() && store.overlay_adds.is_empty() { return Ok(None); }

    let (mut w, mut s, mut e, mut n) = (f64::MAX, f64::MAX, f64::MIN, f64::MIN);
    let mut count = 0usize;

    if let Some(ref b) = store.batch {
        let lats = col_lat(b);
        let lngs = col_lng(b);
        let ids = col_id(b);
        for i in 0..b.num_rows() {
            let id = ids.value(i);
            if store.overlay_dead.contains(&id) { continue; }
            let (lat, lng) = if let Some(p) = store.overlay_patches.get(&id) {
                (p.lat, p.lng)
            } else {
                (lats.value(i), lngs.value(i))
            };
            if lng < w { w = lng; }
            if lat < s { s = lat; }
            if lng > e { e = lng; }
            if lat > n { n = lat; }
            count += 1;
        }
    }
    for loc in &store.overlay_adds {
        if loc.lng < w { w = loc.lng; }
        if loc.lat < s { s = loc.lat; }
        if loc.lng > e { e = loc.lng; }
        if loc.lat > n { n = loc.lat; }
        count += 1;
    }

    log::debug!("[cmd] store_bounds total={}ms count={}", _t.elapsed().as_millis(), count);
    if count == 0 { Ok(None) } else { Ok(Some([w, s, e, n])) }
}

#[tauri::command]
pub fn store_location_count(state: tauri::State<'_, StoreState>) -> Result<usize, String> {
    let store = state.lock().map_err(|e| e.to_string())?;
    Ok(store.alive_count)
}

#[tauri::command]
pub fn store_extra_field_values(state: tauri::State<'_, StoreState>, field: String) -> Result<Vec<String>, String> {
    let _t = std::time::Instant::now();
    let store = state.lock().map_err(|e| e.to_string())?;
    let mut seen = std::collections::BTreeSet::new();

    let mut scan_extra_json = |json_str: &str| {
        if let Ok(map) = serde_json::from_str::<serde_json::Map<String, serde_json::Value>>(json_str) {
            if let Some(v) = map.get(&field) {
                let s = match v {
                    serde_json::Value::String(s) => s.clone(),
                    other => other.to_string(),
                };
                seen.insert(s);
            }
        }
    };

    if let Some(ref b) = store.batch {
        let ids = col_id(b);
        let extras = col_extra(b);
        for i in 0..b.num_rows() {
            let id = ids.value(i);
            if store.overlay_dead.contains(&id) { continue; }
            if store.overlay_patches.contains_key(&id) { continue; }
            if !extras.is_null(i) {
                scan_extra_json(extras.value(i));
            }
        }
    }
    for loc in store.overlay_patches.values() {
        if let Some(ref extra) = loc.extra {
            if let Some(v) = extra.get(&field) {
                let s = match v {
                    serde_json::Value::String(s) => s.clone(),
                    other => other.to_string(),
                };
                seen.insert(s);
            }
        }
    }
    for loc in &store.overlay_adds {
        if let Some(ref extra) = loc.extra {
            if let Some(v) = extra.get(&field) {
                let s = match v {
                    serde_json::Value::String(s) => s.clone(),
                    other => other.to_string(),
                };
                seen.insert(s);
            }
        }
    }

    log::debug!("[cmd] store_extra_field_values field={} total={}ms", field, _t.elapsed().as_millis());
    Ok(seen.into_iter().collect())
}

#[tauri::command]
pub fn store_has_location(state: tauri::State<'_, StoreState>, id: u32) -> Result<bool, String> {
    let store = state.lock().map_err(|e| e.to_string())?;
    Ok(store.get_loc_by_id(id).is_some())
}

// ---------------------------------------------------------------------------
// Selections
// ---------------------------------------------------------------------------

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SelectionInput {
    pub props: SelectionProps,
    pub color: [u8; 3],
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncSelectionsResult {
    pub counts: Vec<usize>,
    pub patch_file: Option<String>,
    pub selected_count: usize,
}

#[tauri::command]
pub async fn store_sync_selections(
    app: tauri::AppHandle,
    state: tauri::State<'_, StoreState>,
    sels: Vec<SelectionInput>,
) -> Result<SyncSelectionsResult, String> {
    let _t = std::time::Instant::now();
    let (counts, buf, selected_count, num_cells) = {
        let mut store = state.lock().map_err(|e| e.to_string())?;

        let view = store.loc_view();
        let masks: Vec<Vec<bool>> = sels.iter()
            .map(|sel| selections::resolve_bitmask(&view, &sel.props))
            .collect();
        let counts: Vec<usize> = masks.iter()
            .map(|m| m.iter().filter(|&&b| b).count())
            .collect();

        let id_to_sel = view.collect_id_to_selection(&masks);
        let all_selected: HashSet<u32> = id_to_sel.keys().copied().collect();
        let selected_count = all_selected.len();

        // Pack grouped bitmask binary:
        // [u8 num_sels][per sel: u8 r, g, b]
        // [u8 num_cells][per cell: u8 cell_char, u32 loc_count, per sel: ceil(loc_count/8) bitmask bytes]
        let num_sels = sels.len();
        let mut buf: Vec<u8> = Vec::new();
        buf.push(num_sels as u8);
        for sel in &sels {
            buf.extend_from_slice(&sel.color);
        }

        let num_cells = store.render_cells.len();
        buf.push(num_cells as u8);

        for (cell_key, cr) in &store.render_cells {
            buf.push(cell_key.as_bytes()[0]);
            let n = cr.id_order.len();
            buf.extend_from_slice(&(n as u32).to_le_bytes());
            let mask_bytes = n.div_ceil(8);
            for si in 0..num_sels {
                let mut bitmask = vec![0u8; mask_bytes];
                for (li, &id) in cr.id_order.iter().enumerate() {
                    if let Some(&sel_idx) = id_to_sel.get(&id) {
                        if sel_idx == si {
                            bitmask[li / 8] |= 1 << (li % 8);
                        }
                    }
                }
                buf.extend_from_slice(&bitmask);
            }
        }

        store.selected_ids = all_selected;
        let mut color_map = HashMap::new();
        for (&id, &si) in &id_to_sel {
            color_map.insert(id, sels[si].color);
        }
        store.selected_colors = color_map;

        let render_total: usize = store.render_cells.values().map(|cr| cr.id_order.len()).sum();
        log::debug!("[cmd] store_sync_selections total={}ms sels={} selected={} cells={} buf_size={} batch_rows={} overlay_adds={} dead={} alive={} render_total={} mask_len={} counts={:?}",
            _t.elapsed().as_millis(), sels.len(), selected_count, num_cells, buf.len(),
            store.batch.as_ref().map_or(0, |b| b.num_rows()), store.overlay_adds.len(),
            store.overlay_dead.len(), store.alive_count, render_total,
            masks.first().map_or(0, |m| m.len()), counts);

        (counts, buf, selected_count, num_cells)
    };

    let patch_file = if num_cells > 0 {
        let path = app.path().temp_dir().map_err(|e| e.to_string())?
            .join("mma_sel_patches.bin");
        let p = path.clone();
        tokio::task::spawn_blocking(move || {
            std::fs::write(&p, &buf).map_err(|e| e.to_string())
        }).await.map_err(|e| e.to_string())??;
        Some(path.to_string_lossy().into_owned())
    } else {
        None
    };

    Ok(SyncSelectionsResult { counts, patch_file, selected_count })
}

#[tauri::command]
pub fn store_get_selected_ids_list(state: tauri::State<'_, StoreState>) -> Result<Vec<u32>, String> {
    let store = state.lock().map_err(|e| e.to_string())?;
    Ok(store.selected_ids.iter().copied().collect())
}

#[tauri::command]
pub fn store_set_selected_ids(state: tauri::State<'_, StoreState>, ids: Vec<u32>) -> Result<(), String> {
    let mut store = state.lock().map_err(|e| e.to_string())?;
    store.selected_ids = ids.into_iter().collect();
    Ok(())
}

#[tauri::command]
pub fn store_resolve_selection(state: tauri::State<'_, StoreState>, props: SelectionProps) -> Result<Vec<u32>, String> {
    let store = state.lock().map_err(|e| e.to_string())?;
    let view = store.loc_view();
    Ok(selections::resolve(&view, &props))
}

// ---------------------------------------------------------------------------
// Selection commands
// ---------------------------------------------------------------------------

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SelectionResult {
    pub key: String,
    pub count: usize,
    pub selection_version: u64,
}

#[tauri::command]
pub fn store_add_selection(state: tauri::State<'_, StoreState>, props: SelectionProps) -> Result<SelectionResult, String> {
    let mut store = state.lock().map_err(|e| e.to_string())?;
    let view = store.loc_view();
    let locations = selections::resolve(&view, &props);
    let key = selection_key(&props, &locations);
    let color = color_for_key(&key);
    let count = locations.len();
    store.selections.push(Selection { key: key.clone(), color, props, locations });
    store.selection_version += 1;
    Ok(SelectionResult { key, count, selection_version: store.selection_version })
}

#[tauri::command]
pub fn store_remove_selection(state: tauri::State<'_, StoreState>, key: String) -> Result<u64, String> {
    let mut store = state.lock().map_err(|e| e.to_string())?;
    store.selections.retain(|s| s.key != key);
    store.selection_version += 1;
    Ok(store.selection_version)
}

#[tauri::command]
pub fn store_reset_selections(state: tauri::State<'_, StoreState>) -> Result<u64, String> {
    let mut store = state.lock().map_err(|e| e.to_string())?;
    store.selections.clear();
    store.selection_version += 1;
    Ok(store.selection_version)
}

#[tauri::command]
pub fn store_get_selections(state: tauri::State<'_, StoreState>) -> Result<Vec<SelectionSummary>, String> {
    let store = state.lock().map_err(|e| e.to_string())?;
    Ok(store.selections.iter().map(|s| SelectionSummary {
        key: s.key.clone(),
        color: s.color,
        sel_type: selection_type_name(&s.props),
        count: s.locations.len(),
    }).collect())
}

#[tauri::command]
pub fn store_get_selected_ids(state: tauri::State<'_, StoreState>) -> Result<Vec<u32>, String> {
    let store = state.lock().map_err(|e| e.to_string())?;
    let mut all = HashSet::new();
    for sel in &store.selections { for &id in &sel.locations { all.insert(id); } }
    Ok(all.into_iter().collect())
}

#[tauri::command]
pub fn store_refresh_selections(state: tauri::State<'_, StoreState>) -> Result<u64, String> {
    let _t = std::time::Instant::now();
    let mut store = state.lock().map_err(|e| e.to_string())?;
    let resolved: Vec<Vec<u32>> = {
        let view = store.loc_view();
        store.selections.iter().map(|s| selections::resolve(&view, &s.props)).collect()
    };
    let n = resolved.len();
    for (i, ids) in resolved.into_iter().enumerate() {
        store.selections[i].locations = ids;
    }
    store.selection_version += 1;
    log::debug!("[cmd] store_refresh_selections total={}ms sels={}", _t.elapsed().as_millis(), n);
    Ok(store.selection_version)
}

// --- Helpers ---

fn selection_key(props: &SelectionProps, locations: &[u32]) -> String {
    match props {
        SelectionProps::Locations { .. } => format!("locs:{}", locations.len()),
        SelectionProps::Everything => "everything".into(),
        SelectionProps::Polygon { .. } => format!("polygon:{}", uuid::Uuid::new_v4()),
        SelectionProps::Tag { tag_id } => format!("tag:{tag_id}"),
        SelectionProps::Untagged => "untagged".into(),
        SelectionProps::Unpanned => "unpanned".into(),
        SelectionProps::PanoIds => "panoids".into(),
        SelectionProps::NotPanoIds => "notpanoids".into(),
        SelectionProps::Duplicates { distance } => format!("duplicates:{distance}"),
        SelectionProps::Manual { .. } => "manual".into(),
        SelectionProps::ValidationState { state, .. } => format!("validation:{state}"),
        SelectionProps::Intersection { selections } => selections.iter().map(|s| format!("({})", s.key)).collect::<Vec<_>>().join("^"),
        SelectionProps::Union { selections } => selections.iter().map(|s| format!("({})", s.key)).collect::<Vec<_>>().join("|"),
        SelectionProps::Invert { selections } => {
            if let Some(s) = selections.first() { format!("!{}", s.key) } else { "!".into() }
        }
        SelectionProps::Filter { field, op, value, value2 } => {
            let v2 = value2.as_ref().map(|v| format!(":{v}")).unwrap_or_default();
            format!("filter:{field}:{op}:{value}{v2}")
        }
    }
}

fn selection_type_name(props: &SelectionProps) -> String {
    match props {
        SelectionProps::Locations { .. } => "Locations",
        SelectionProps::Everything => "Everything",
        SelectionProps::Polygon { .. } => "Polygon",
        SelectionProps::Tag { .. } => "Tag",
        SelectionProps::Untagged => "Untagged",
        SelectionProps::Unpanned => "Unpanned",
        SelectionProps::PanoIds => "PanoIds",
        SelectionProps::NotPanoIds => "NotPanoIds",
        SelectionProps::Duplicates { .. } => "Duplicates",
        SelectionProps::Manual { .. } => "Manual",
        SelectionProps::ValidationState { .. } => "ValidationState",
        SelectionProps::Intersection { .. } => "Intersection",
        SelectionProps::Union { .. } => "Union",
        SelectionProps::Invert { .. } => "Invert",
        SelectionProps::Filter { .. } => "Filter",
    }.into()
}

fn color_for_key(key: &str) -> [u8; 3] {
    let mut hash: u32 = 0;
    for b in key.bytes() { hash = hash.wrapping_mul(31).wrapping_add(b as u32); }
    let hue = (hash % 360) as f64;
    let (r, g, b) = crate::util::hsl_to_rgb(hue, 0.65, 0.5);
    [r, g, b]
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::fast_io::LocationData;

    fn loc(id: u32, lat: f64, lng: f64) -> LocationData {
        LocationData {
            id,
            lat,
            lng,
            heading: 0.0,
            pitch: 0.0,
            zoom: 1.0,
            pano_id: None,
            flags: 0,
            tags: vec![],
            extra: None,
            created_at: String::new(),
            modified_at: None,
        }
    }

    fn loc_with_tags(id: u32, lat: f64, lng: f64, tags: Vec<u32>) -> LocationData {
        LocationData { tags, ..loc(id, lat, lng) }
    }

    fn loc_with_heading(id: u32, lat: f64, lng: f64, heading: f64) -> LocationData {
        LocationData { heading, ..loc(id, lat, lng) }
    }

    fn patch() -> LocationPatch {
        LocationPatch {
            lat: None, lng: None, heading: None, pitch: None, zoom: None,
            pano_id: None, flags: None, tags: None, extra: None,
            created_at: None, modified_at: None,
        }
    }

    fn setup_store_with(locs: &[LocationData]) -> Store {
        let mut store = Store::new();
        store.map_id = Some("test".into());
        store.batch = Some(empty_batch());
        for l in locs {
            store.add_tag_counts(std::slice::from_ref(l));
            store.overlay_add(l.clone());
            let gh = encode_geohash(l.lat, l.lng);
            let cell = render_cell_key(&gh).to_string();
            store.cell_add_render(&cell, l.id);
        }
        store.alive_count = locs.len();
        store
    }

    // -----------------------------------------------------------------------
    // Overlay basics
    // -----------------------------------------------------------------------

    #[test]
    fn overlay_add_increments_alive_count() {
        let mut store = setup_store_with(&[]);
        let l = loc(1, 10.0, 20.0);
        store.overlay_add(l);
        assert_eq!(store.alive_count, 1);
    }

    #[test]
    fn overlay_add_then_get() {
        let mut store = setup_store_with(&[]);
        let l = loc(1, 10.0, 20.0);
        store.overlay_add(l.clone());
        let got = store.get_loc_by_id(1).unwrap();
        assert_eq!(got.lat, 10.0);
        assert_eq!(got.lng, 20.0);
    }

    #[test]
    fn overlay_remove_decrements_alive_count() {
        let l = loc(1, 10.0, 20.0);
        let mut store = setup_store_with(&[l.clone()]);
        assert_eq!(store.alive_count, 1);
        store.overlay_remove(&[l]);
        assert_eq!(store.alive_count, 0);
    }

    #[test]
    fn overlay_remove_makes_get_return_none() {
        let l = loc(1, 10.0, 20.0);
        let mut store = setup_store_with(&[l.clone()]);
        store.overlay_remove(&[l]);
        assert!(store.get_loc_by_id(1).is_none());
    }

    #[test]
    fn overlay_update_changes_fields() {
        let l = loc(1, 10.0, 20.0);
        let mut store = setup_store_with(&[l]);
        store.overlay_update(1, &LocationPatch { lat: Some(50.0), heading: Some(90.0), ..patch() });
        let got = store.get_loc_by_id(1).unwrap();
        assert_eq!(got.lat, 50.0);
        assert_eq!(got.heading, 90.0);
        assert_eq!(got.lng, 20.0); // unchanged
    }

    #[test]
    fn overlay_update_nonexistent_is_noop() {
        let mut store = setup_store_with(&[]);
        store.overlay_update(999, &LocationPatch { lat: Some(50.0), ..patch() });
        assert!(store.get_loc_by_id(999).is_none());
    }

    #[test]
    fn collect_all_locations() {
        let locs = vec![loc(1, 10.0, 20.0), loc(2, 30.0, 40.0)];
        let store = setup_store_with(&locs);
        let all = store.collect_all_locations();
        assert_eq!(all.len(), 2);
    }

    // -----------------------------------------------------------------------
    // Tag counts
    // -----------------------------------------------------------------------

    #[test]
    fn tag_counts_after_add() {
        let l1 = loc_with_tags(1, 0.0, 0.0, vec![10, 20]);
        let l2 = loc_with_tags(2, 1.0, 1.0, vec![10]);
        let store = setup_store_with(&[l1, l2]);
        assert_eq!(store.tag_counts.get(&10), Some(&2));
        assert_eq!(store.tag_counts.get(&20), Some(&1));
    }

    #[test]
    fn tag_counts_after_remove() {
        let l1 = loc_with_tags(1, 0.0, 0.0, vec![10, 20]);
        let l2 = loc_with_tags(2, 1.0, 1.0, vec![10]);
        let mut store = setup_store_with(&[l1.clone(), l2]);
        store.remove_tag_counts(&[l1]);
        assert_eq!(store.tag_counts.get(&10), Some(&1));
        assert_eq!(store.tag_counts.get(&20), Some(&0));
    }

    #[test]
    fn tag_counts_saturate_at_zero() {
        let l = loc_with_tags(1, 0.0, 0.0, vec![10]);
        let mut store = setup_store_with(&[]);
        store.remove_tag_counts(&[l]);
        assert_eq!(store.tag_counts.get(&10), None);
    }

    // -----------------------------------------------------------------------
    // Undo / Redo
    // -----------------------------------------------------------------------

    #[test]
    fn undo_add() {
        let l = loc(1, 10.0, 20.0);
        let mut store = setup_store_with(&[l.clone()]);
        store.push_undo(EditEntry { created: vec![l.clone()], removed: vec![] });

        let _delta = apply_edit_reverse(&mut store, &EditEntry { created: vec![l], removed: vec![] });
        assert_eq!(store.alive_count, 0);
        assert!(store.get_loc_by_id(1).is_none());
    }

    #[test]
    fn undo_remove() {
        let l = loc(1, 10.0, 20.0);
        let mut store = setup_store_with(&[]);
        // simulate: location was removed, undo should re-add it
        let _delta = apply_edit_reverse(&mut store, &EditEntry { created: vec![], removed: vec![l.clone()] });
        assert_eq!(store.alive_count, 1);
        let got = store.get_loc_by_id(1).unwrap();
        assert_eq!(got.lat, 10.0);
    }

    #[test]
    fn undo_update_restores_original() {
        let original = loc_with_heading(1, 10.0, 20.0, 0.0);
        let updated = loc_with_heading(1, 10.0, 20.0, 90.0);
        let mut store = setup_store_with(&[updated.clone()]);

        let entry = EditEntry { created: vec![updated], removed: vec![original.clone()] };
        apply_edit_reverse(&mut store, &entry);

        let got = store.get_loc_by_id(1).unwrap();
        assert_eq!(got.heading, 0.0);
    }

    #[test]
    fn redo_after_undo() {
        let l = loc(1, 10.0, 20.0);
        let mut store = setup_store_with(&[l.clone()]);
        let entry = EditEntry { created: vec![l.clone()], removed: vec![] };

        apply_edit_reverse(&mut store, &entry);
        assert_eq!(store.alive_count, 0);

        apply_edit_forward(&mut store, &entry);
        assert_eq!(store.alive_count, 1);
        assert!(store.get_loc_by_id(1).is_some());
    }

    #[test]
    fn undo_stack_capped_at_max() {
        let mut store = setup_store_with(&[]);
        for i in 0..MAX_UNDO_ENTRIES + 50 {
            let l = loc(i as u32, 0.0, 0.0);
            store.push_undo(EditEntry { created: vec![l], removed: vec![] });
        }
        assert_eq!(store.undo_stack.len(), MAX_UNDO_ENTRIES);
    }

    #[test]
    fn redo_stack_cleared_on_new_edit() {
        let mut store = setup_store_with(&[]);
        store.redo_stack.push(EditEntry { created: vec![], removed: vec![] });
        assert!(!store.redo_stack.is_empty());

        store.push_undo(EditEntry { created: vec![loc(1, 0.0, 0.0)], removed: vec![] });
        store.redo_stack.clear();
        assert!(store.redo_stack.is_empty());
    }

    // -----------------------------------------------------------------------
    // Tag counts through undo/redo
    // -----------------------------------------------------------------------

    #[test]
    fn tag_counts_correct_after_undo_add() {
        let l = loc_with_tags(1, 0.0, 0.0, vec![10, 20]);
        let mut store = setup_store_with(&[l.clone()]);
        assert_eq!(store.tag_counts.get(&10), Some(&1));

        let entry = EditEntry { created: vec![l], removed: vec![] };
        apply_edit_reverse(&mut store, &entry);
        assert_eq!(store.tag_counts.get(&10), Some(&0));
    }

    #[test]
    fn tag_counts_correct_after_undo_remove() {
        let l = loc_with_tags(1, 0.0, 0.0, vec![10]);
        let mut store = setup_store_with(&[]);
        assert_eq!(store.tag_counts.get(&10), None);

        let entry = EditEntry { created: vec![], removed: vec![l] };
        apply_edit_reverse(&mut store, &entry);
        assert_eq!(store.tag_counts.get(&10), Some(&1));
    }

    #[test]
    fn tag_counts_correct_after_undo_tag_change() {
        let old = loc_with_tags(1, 0.0, 0.0, vec![10]);
        let new = loc_with_tags(1, 0.0, 0.0, vec![20]);
        let mut store = setup_store_with(&[new.clone()]);
        store.tag_counts.clear();
        store.add_tag_counts(&[new.clone()]);
        assert_eq!(store.tag_counts.get(&20), Some(&1));
        assert_eq!(store.tag_counts.get(&10), None);

        let entry = EditEntry { created: vec![new], removed: vec![old] };
        apply_edit_reverse(&mut store, &entry);

        assert_eq!(store.tag_counts.get(&10), Some(&1));
        assert_eq!(store.tag_counts.get(&20), Some(&0));
    }

    #[test]
    fn tag_counts_survive_undo_redo_cycle() {
        let l = loc_with_tags(1, 0.0, 0.0, vec![10]);
        let mut store = setup_store_with(&[l.clone()]);
        let entry = EditEntry { created: vec![l.clone()], removed: vec![] };

        apply_edit_reverse(&mut store, &entry);
        assert_eq!(store.tag_counts.get(&10), Some(&0));

        apply_edit_forward(&mut store, &entry);
        assert_eq!(store.tag_counts.get(&10), Some(&1));
    }

    // -----------------------------------------------------------------------
    // Render delta
    // -----------------------------------------------------------------------

    #[test]
    fn delta_has_added_entry_for_new_location() {
        let l = loc(1, 10.0, 20.0);
        let mut store = setup_store_with(&[]);
        let entry = EditEntry { created: vec![l], removed: vec![] };
        let delta = apply_edit_forward(&mut store, &entry);
        assert_eq!(delta.added.len(), 1);
        assert_eq!(delta.added[0].id, 1);
        assert_eq!(delta.removed.len(), 0);
    }

    #[test]
    fn delta_has_removed_entry_for_deleted_location() {
        let l = loc(1, 10.0, 20.0);
        let mut store = setup_store_with(&[l.clone()]);
        let entry = EditEntry { created: vec![], removed: vec![l] };
        let delta = apply_edit_forward(&mut store, &entry);
        assert_eq!(delta.removed.len(), 1);
        assert_eq!(delta.removed[0].id, 1);
        assert_eq!(delta.added.len(), 0);
    }

    #[test]
    fn delta_has_both_for_moved_location() {
        let old = loc(1, 10.0, 20.0);
        let new = loc(1, 50.0, 60.0);
        let mut store = setup_store_with(&[old.clone()]);

        let entry = EditEntry { created: vec![new], removed: vec![old] };
        let delta = apply_edit_forward(&mut store, &entry);
        // position changed => remove old + add new
        assert_eq!(delta.removed.len(), 1);
        assert_eq!(delta.added.len(), 1);
    }

    // -----------------------------------------------------------------------
    // "Samey locations" optimization: skip re-render when only non-render
    // fields changed (e.g. pitch, zoom, tags, extra)
    // -----------------------------------------------------------------------

    #[test]
    fn samey_location_skips_render_delta() {
        let old = loc(1, 10.0, 20.0);
        let mut new = loc(1, 10.0, 20.0);
        new.pitch = 45.0; // non-render field
        new.zoom = 3.0;   // non-render field
        let mut store = setup_store_with(&[old.clone()]);

        let entry = EditEntry { created: vec![new], removed: vec![old] };
        let delta = apply_edit_forward(&mut store, &entry);

        assert_eq!(delta.added.len(), 0, "no re-render needed for pitch/zoom change");
        assert_eq!(delta.removed.len(), 0);
    }

    #[test]
    fn samey_location_with_heading_change_does_rerender() {
        let old = loc_with_heading(1, 10.0, 20.0, 0.0);
        let new = loc_with_heading(1, 10.0, 20.0, 90.0);
        let mut store = setup_store_with(&[old.clone()]);

        let entry = EditEntry { created: vec![new], removed: vec![old] };
        let delta = apply_edit_forward(&mut store, &entry);

        assert_eq!(delta.added.len(), 1, "heading change requires re-render");
        assert_eq!(delta.removed.len(), 1);
    }

    #[test]
    fn samey_location_with_lat_change_does_rerender() {
        let old = loc(1, 10.0, 20.0);
        let new = loc(1, 11.0, 20.0);
        let mut store = setup_store_with(&[old.clone()]);

        let entry = EditEntry { created: vec![new], removed: vec![old] };
        let delta = apply_edit_forward(&mut store, &entry);

        assert!(delta.added.len() + delta.removed.len() > 0, "lat change requires re-render");
    }

    #[test]
    fn samey_tag_only_change_skips_render() {
        let old = loc_with_tags(1, 10.0, 20.0, vec![10]);
        let new = loc_with_tags(1, 10.0, 20.0, vec![20]);
        let mut store = setup_store_with(&[old.clone()]);

        let entry = EditEntry { created: vec![new], removed: vec![old] };
        let delta = apply_edit_forward(&mut store, &entry);

        assert_eq!(delta.added.len(), 0, "tag-only change should skip render");
        assert_eq!(delta.removed.len(), 0);
    }

    // -----------------------------------------------------------------------
    // finish_mutation
    // -----------------------------------------------------------------------

    #[test]
    fn finish_mutation_reports_correct_state() {
        let l = loc_with_tags(1, 0.0, 0.0, vec![10]);
        let mut store = setup_store_with(&[l]);
        store.push_undo(EditEntry { created: vec![], removed: vec![] });

        let result = store.finish_mutation(RenderDelta::default());
        assert_eq!(result.location_count, 1);
        assert!(result.can_undo);
        assert!(!result.can_redo);
        assert_eq!(result.tag_counts.get(&10), Some(&1));
        assert_eq!(result.version, 1);
    }

    // -----------------------------------------------------------------------
    // Geohash
    // -----------------------------------------------------------------------

    #[test]
    fn geohash_deterministic() {
        let a = encode_geohash(51.5, -0.1);
        let b = encode_geohash(51.5, -0.1);
        assert_eq!(a, b);
    }

    #[test]
    fn geohash_different_for_distant_points() {
        let a = encode_geohash(51.5, -0.1);
        let b = encode_geohash(-33.9, 151.2);
        assert_ne!(a, b);
    }

    #[test]
    fn geohash_length_matches_precision() {
        let gh = encode_geohash(0.0, 0.0);
        assert_eq!(gh.len(), GEOHASH_PRECISION);
    }

    // -----------------------------------------------------------------------
    // Render cell tracking
    // -----------------------------------------------------------------------

    #[test]
    fn cell_add_and_lookup() {
        let mut store = setup_store_with(&[]);
        store.cell_add_render("s", 1);
        let (cell, idx) = store.cell_lookup(1).unwrap();
        assert_eq!(cell, "s");
        assert_eq!(idx, 0);
    }

    #[test]
    fn cell_remove_returns_correct_info() {
        let mut store = setup_store_with(&[]);
        store.cell_add_render("s", 1);
        store.cell_add_render("s", 2);
        let removal = store.cell_remove_render(1).unwrap();
        assert_eq!(removal.id, 1);
        assert_eq!(removal.cell, "s");
        // after removal, id 2 should still be findable
        assert!(store.cell_lookup(2).is_some());
    }

    #[test]
    fn cell_remove_nonexistent_returns_none() {
        let store = setup_store_with(&[]);
        assert!(store.id_to_cell.get(&999).is_none());
    }

    // -----------------------------------------------------------------------
    // ID allocation
    // -----------------------------------------------------------------------

    #[test]
    fn alloc_id_increments() {
        let mut store = Store::new();
        let a = store.alloc_id();
        let b = store.alloc_id();
        assert_eq!(b, a + 1);
    }

    #[test]
    fn alloc_tag_id_increments() {
        let mut store = Store::new();
        let a = store.alloc_tag_id();
        let b = store.alloc_tag_id();
        assert_eq!(b, a + 1);
    }

    // -----------------------------------------------------------------------
    // Bake overlay
    // -----------------------------------------------------------------------

    #[test]
    fn bake_overlay_merges_adds() {
        let mut store = setup_store_with(&[loc(1, 10.0, 20.0), loc(2, 30.0, 40.0)]);
        assert_eq!(store.overlay_adds.len(), 2);

        store.bake_overlay();
        assert!(store.overlay_adds.is_empty());
        assert_eq!(store.batch.as_ref().unwrap().num_rows(), 2);
        // locations still accessible
        assert!(store.get_loc_by_id(1).is_some());
        assert!(store.get_loc_by_id(2).is_some());
    }

    #[test]
    fn bake_overlay_applies_patches() {
        let mut store = setup_store_with(&[loc(1, 10.0, 20.0)]);
        store.bake_overlay();
        // now loc 1 is in the batch; patch it
        store.overlay_update(1, &LocationPatch { lat: Some(99.0), ..patch() });
        store.bake_overlay();

        let got = store.get_loc_by_id(1).unwrap();
        assert_eq!(got.lat, 99.0);
        assert!(store.overlay_patches.is_empty());
    }

    #[test]
    fn bake_overlay_removes_dead() {
        let l = loc(1, 10.0, 20.0);
        let mut store = setup_store_with(&[l.clone()]);
        store.bake_overlay();
        // now remove
        store.overlay_remove(&[l]);
        store.bake_overlay();
        assert_eq!(store.batch.as_ref().unwrap().num_rows(), 0);
    }

    // -----------------------------------------------------------------------
    // Edge cases: no-op updates should not create undo entries
    // (mirrors the filter in store_update_locations)
    // -----------------------------------------------------------------------

    #[test]
    fn noop_update_produces_no_undo_entry() {
        let l = loc_with_heading(1, 10.0, 20.0, 45.0);
        let mut store = setup_store_with(&[l.clone()]);

        // "update" with identical values
        store.overlay_update(1, &LocationPatch { heading: Some(45.0), ..patch() });
        let new = store.get_loc_by_id(1).unwrap();

        // simulate the filter from store_update_locations
        let pairs: Vec<_> = vec![(l.clone(), new.clone())]
            .into_iter()
            .filter(|(o, n)| o != n)
            .collect();
        assert!(pairs.is_empty(), "identical update should be filtered out");
    }

    #[test]
    fn real_update_passes_filter() {
        let l = loc_with_heading(1, 10.0, 20.0, 0.0);
        let mut store = setup_store_with(&[l.clone()]);

        store.overlay_update(1, &LocationPatch { heading: Some(90.0), ..patch() });
        let new = store.get_loc_by_id(1).unwrap();

        let pairs: Vec<_> = vec![(l, new)]
            .into_iter()
            .filter(|(o, n)| o != n)
            .collect();
        assert_eq!(pairs.len(), 1, "changed update should pass filter");
    }

    #[test]
    fn batch_update_mixed_changed_unchanged() {
        let l1 = loc_with_heading(1, 10.0, 20.0, 0.0);
        let l2 = loc_with_heading(2, 30.0, 40.0, 90.0);
        let mut store = setup_store_with(&[l1.clone(), l2.clone()]);

        // update l1 (real change), "update" l2 with same value (noop)
        store.overlay_update(1, &LocationPatch { heading: Some(180.0), ..patch() });
        store.overlay_update(2, &LocationPatch { heading: Some(90.0), ..patch() });
        let n1 = store.get_loc_by_id(1).unwrap();
        let n2 = store.get_loc_by_id(2).unwrap();

        let (changed_old, changed_new): (Vec<_>, Vec<_>) = vec![(l1, n1), (l2, n2)]
            .into_iter()
            .filter(|(o, n)| o != n)
            .unzip();

        assert_eq!(changed_old.len(), 1, "only l1 should be in undo");
        assert_eq!(changed_old[0].id, 1);
        assert_eq!(changed_new[0].heading, 180.0);
    }

    // -----------------------------------------------------------------------
    // Edge case: re-add a previously removed ID
    // -----------------------------------------------------------------------

    #[test]
    fn readd_after_remove_via_overlay() {
        let l = loc(1, 10.0, 20.0);
        let mut store = setup_store_with(&[l.clone()]);
        assert_eq!(store.alive_count, 1);

        store.overlay_remove(&[l.clone()]);
        assert_eq!(store.alive_count, 0);
        assert!(store.get_loc_by_id(1).is_none());

        // re-add with different position
        let l2 = loc(1, 50.0, 60.0);
        store.overlay_add(l2);
        assert_eq!(store.alive_count, 1);
        let got = store.get_loc_by_id(1).unwrap();
        assert_eq!(got.lat, 50.0);
    }

    #[test]
    fn readd_after_remove_through_undo() {
        let l = loc(1, 10.0, 20.0);
        let mut store = setup_store_with(&[l.clone()]);

        // remove it
        let remove_entry = EditEntry { created: vec![], removed: vec![l.clone()] };
        apply_edit_forward(&mut store, &remove_entry);
        assert_eq!(store.alive_count, 0);

        // undo the removal
        apply_edit_reverse(&mut store, &remove_entry);
        assert_eq!(store.alive_count, 1);
        let got = store.get_loc_by_id(1).unwrap();
        assert_eq!(got.lat, 10.0);
    }

    // -----------------------------------------------------------------------
    // Edge case: cell swap-remove correctness
    // -----------------------------------------------------------------------

    #[test]
    fn cell_swap_remove_maintains_correct_indices() {
        let mut store = setup_store_with(&[]);
        store.cell_add_render("s", 10);
        store.cell_add_render("s", 20);
        store.cell_add_render("s", 30);

        // remove the first — 30 should move into slot 0
        let removal = store.cell_remove_render(10).unwrap();
        assert_eq!(removal.cell_index, 0);

        // 30 should now be at index 0
        let (_, idx30) = store.cell_lookup(30).unwrap();
        assert_eq!(idx30, 0, "id 30 should have been swapped into slot 0");

        // 20 should still be at index 1
        let (_, idx20) = store.cell_lookup(20).unwrap();
        assert_eq!(idx20, 1, "id 20 should be undisturbed");

        // cell should have 2 entries
        let cr = store.render_cells.get("s").unwrap();
        assert_eq!(cr.id_order.len(), 2);
    }

    #[test]
    fn cell_swap_remove_last_element() {
        let mut store = setup_store_with(&[]);
        store.cell_add_render("s", 10);
        store.cell_add_render("s", 20);

        // remove the last — no swap needed
        let removal = store.cell_remove_render(20).unwrap();
        assert_eq!(removal.cell_index, 1);

        let (_, idx10) = store.cell_lookup(10).unwrap();
        assert_eq!(idx10, 0, "id 10 should be undisturbed");

        assert!(store.cell_lookup(20).is_none());
    }

    // -----------------------------------------------------------------------
    // Edge case: undo/redo with overlay patches on top of batch rows
    // -----------------------------------------------------------------------

    #[test]
    fn undo_update_when_location_is_in_baked_batch() {
        let l = loc_with_heading(1, 10.0, 20.0, 0.0);
        let mut store = setup_store_with(&[l.clone()]);
        store.bake_overlay();
        // l is now in the batch, not in overlay_adds

        // update via overlay patch
        let updated = loc_with_heading(1, 10.0, 20.0, 90.0);
        store.overlay_update(1, &LocationPatch { heading: Some(90.0), ..patch() });
        assert_eq!(store.get_loc_by_id(1).unwrap().heading, 90.0);

        // undo: apply_edit should restore original via overlay
        let entry = EditEntry { created: vec![updated], removed: vec![l] };
        apply_edit_reverse(&mut store, &entry);

        let got = store.get_loc_by_id(1).unwrap();
        assert_eq!(got.heading, 0.0, "undo should restore original heading");
    }

    #[test]
    fn multiple_undo_redo_cycles_consistent() {
        let l = loc_with_tags(1, 10.0, 20.0, vec![10]);
        let mut store = setup_store_with(&[l.clone()]);

        let updated = loc_with_tags(1, 10.0, 20.0, vec![20]);
        let entry = EditEntry { created: vec![updated.clone()], removed: vec![l.clone()] };

        for _ in 0..5 {
            apply_edit_forward(&mut store, &entry);
            assert_eq!(store.get_loc_by_id(1).unwrap().tags, vec![20]);
            assert_eq!(store.tag_counts.get(&20), Some(&1));

            apply_edit_reverse(&mut store, &entry);
            assert_eq!(store.get_loc_by_id(1).unwrap().tags, vec![10]);
            assert_eq!(store.tag_counts.get(&10), Some(&1));
        }
    }

    // -----------------------------------------------------------------------
    // build_update_delta
    // -----------------------------------------------------------------------

    #[test]
    fn update_delta_heading_only_produces_patch() {
        let l = loc_with_heading(1, 10.0, 20.0, 0.0);
        let mut store = setup_store_with(&[l]);
        store.overlay_update(1, &LocationPatch { heading: Some(90.0), ..patch() });
        let new_loc = store.get_loc_by_id(1).unwrap();
        let p = LocationPatch { heading: Some(90.0), ..patch() };
        let delta = build_update_delta(&mut store, 1, &new_loc, &p);
        assert!(delta.added.is_empty());
        assert!(delta.removed.is_empty());
        assert_eq!(delta.updated.len(), 1);
        assert_eq!(delta.updated[0].heading, Some(90.0));
        assert!(delta.updated[0].lat.is_none());
    }

    #[test]
    fn update_delta_same_cell_position_produces_patch() {
        let l = loc(1, 10.0, 20.0);
        let mut store = setup_store_with(&[l]);
        // small position change that stays in the same render cell
        store.overlay_update(1, &LocationPatch { lat: Some(10.001), ..patch() });
        let new_loc = store.get_loc_by_id(1).unwrap();
        let p = LocationPatch { lat: Some(10.001), ..patch() };
        let delta = build_update_delta(&mut store, 1, &new_loc, &p);
        // should be an in-place patch, not a cell migration
        assert_eq!(delta.updated.len(), 1);
        assert!(delta.added.is_empty());
    }

    #[test]
    fn update_delta_cross_cell_position_produces_remove_and_add() {
        let l = loc(1, 10.0, 20.0);
        let mut store = setup_store_with(&[l]);
        // large position change that crosses render cells
        store.overlay_update(1, &LocationPatch { lat: Some(-80.0), lng: Some(-170.0), ..patch() });
        let new_loc = store.get_loc_by_id(1).unwrap();
        let p = LocationPatch { lat: Some(-80.0), lng: Some(-170.0), ..patch() };
        let delta = build_update_delta(&mut store, 1, &new_loc, &p);
        assert_eq!(delta.removed.len(), 1, "old cell entry removed");
        assert_eq!(delta.added.len(), 1, "new cell entry added");
        assert!(delta.updated.is_empty());
    }

    #[test]
    fn update_delta_tags_only_produces_empty_delta() {
        let l = loc_with_tags(1, 10.0, 20.0, vec![10]);
        let mut store = setup_store_with(&[l]);
        store.overlay_update(1, &LocationPatch { tags: Some(vec![20]), ..patch() });
        let new_loc = store.get_loc_by_id(1).unwrap();
        let p = LocationPatch { tags: Some(vec![20]), ..patch() };
        let delta = build_update_delta(&mut store, 1, &new_loc, &p);
        assert!(delta.added.is_empty());
        assert!(delta.removed.is_empty());
        assert!(delta.updated.is_empty());
    }

    // -----------------------------------------------------------------------
    // overlay_update on items in overlay_adds (not yet baked)
    // -----------------------------------------------------------------------

    #[test]
    fn overlay_update_on_overlay_add_item() {
        let mut store = setup_store_with(&[]);
        let l = loc(1, 10.0, 20.0);
        store.overlay_add(l);
        store.overlay_update(1, &LocationPatch { lat: Some(50.0), ..patch() });
        let got = store.get_loc_by_id(1).unwrap();
        assert_eq!(got.lat, 50.0);
        // should still be in overlay_adds, not overlay_patches
        assert_eq!(store.overlay_adds.len(), 1);
        assert_eq!(store.overlay_adds[0].lat, 50.0);
        assert!(store.overlay_patches.is_empty());
    }

    // -----------------------------------------------------------------------
    // collect_all_locations with mixed states
    // -----------------------------------------------------------------------

    #[test]
    fn collect_all_with_dead_patches_and_adds() {
        let l1 = loc(1, 10.0, 20.0);
        let l2 = loc(2, 30.0, 40.0);
        let l3 = loc(3, 50.0, 60.0);
        let mut store = setup_store_with(&[l1.clone(), l2.clone(), l3.clone()]);
        store.bake_overlay();
        // kill l1
        store.overlay_remove(&[l1]);
        // patch l2
        store.overlay_update(2, &LocationPatch { lat: Some(99.0), ..patch() });
        // add l4
        let l4 = loc(4, 70.0, 80.0);
        store.overlay_add(l4);
        store.alive_count = 3; // l2, l3, l4

        let all = store.collect_all_locations();
        assert_eq!(all.len(), 3);
        let ids: Vec<u32> = all.iter().map(|l| l.id).collect();
        assert!(!ids.contains(&1), "dead location should be excluded");
        assert!(ids.contains(&2));
        assert!(ids.contains(&3));
        assert!(ids.contains(&4));
        let l2_collected = all.iter().find(|l| l.id == 2).unwrap();
        assert_eq!(l2_collected.lat, 99.0, "patch should be applied");
    }

    // -----------------------------------------------------------------------
    // bake_overlay with all three operations
    // -----------------------------------------------------------------------

    #[test]
    fn bake_overlay_all_three_simultaneously() {
        let l1 = loc(1, 10.0, 20.0);
        let l2 = loc(2, 30.0, 40.0);
        let mut store = setup_store_with(&[l1.clone(), l2.clone()]);
        store.bake_overlay();
        assert_eq!(store.batch.as_ref().unwrap().num_rows(), 2);

        // dead: remove l1
        store.overlay_remove(&[l1]);
        // patch: modify l2
        store.overlay_update(2, &LocationPatch { heading: Some(180.0), ..patch() });
        // add: new l3
        let l3 = loc(3, 50.0, 60.0);
        store.overlay_add(l3);
        store.alive_count = 2; // l2, l3

        store.bake_overlay();
        assert_eq!(store.batch.as_ref().unwrap().num_rows(), 2);
        assert!(store.overlay_adds.is_empty());
        assert!(store.overlay_patches.is_empty());
        assert!(store.overlay_dead.is_empty());
        // verify data
        assert!(store.get_loc_by_id(1).is_none());
        assert_eq!(store.get_loc_by_id(2).unwrap().heading, 180.0);
        assert_eq!(store.get_loc_by_id(3).unwrap().lat, 50.0);
    }

    // -----------------------------------------------------------------------
    // DeltaOverlay msgpack round-trip
    // -----------------------------------------------------------------------

    #[test]
    fn delta_overlay_msgpack_round_trip_empty() {
        let overlay = DeltaOverlay { adds: vec![], dead_ids: vec![], patches: vec![] };
        let bytes = rmp_serde::to_vec_named(&overlay).unwrap();
        let restored: DeltaOverlay = rmp_serde::from_slice(&bytes).unwrap();
        assert!(restored.adds.is_empty());
        assert!(restored.dead_ids.is_empty());
        assert!(restored.patches.is_empty());
    }

    #[test]
    fn delta_overlay_msgpack_round_trip_with_data() {
        let l1 = loc_with_tags(1, 48.8, 2.35, vec![10, 20]);
        let l2 = loc_with_heading(2, -33.8, 151.2, 90.0);
        let overlay = DeltaOverlay {
            adds: vec![l1.clone()],
            dead_ids: vec![99, 100],
            patches: vec![l2.clone()],
        };
        let bytes = rmp_serde::to_vec_named(&overlay).unwrap();
        let restored: DeltaOverlay = rmp_serde::from_slice(&bytes).unwrap();
        assert_eq!(restored.adds.len(), 1);
        assert_eq!(restored.adds[0], l1);
        assert_eq!(restored.dead_ids, vec![99, 100]);
        assert_eq!(restored.patches.len(), 1);
        assert_eq!(restored.patches[0], l2);
    }

    #[test]
    fn delta_overlay_preserves_extra_fields() {
        let mut l = loc(1, 0.0, 0.0);
        l.extra = Some(serde_json::from_str(r#"{"country":"FR","altitude":35.2}"#).unwrap());
        l.pano_id = Some("CAoSLEF".into());
        l.modified_at = Some("2024-01-15".into());
        let overlay = DeltaOverlay { adds: vec![l.clone()], dead_ids: vec![], patches: vec![] };
        let bytes = rmp_serde::to_vec_named(&overlay).unwrap();
        let restored: DeltaOverlay = rmp_serde::from_slice(&bytes).unwrap();
        assert_eq!(restored.adds[0].extra, l.extra);
        assert_eq!(restored.adds[0].pano_id, l.pano_id);
        assert_eq!(restored.adds[0].modified_at, l.modified_at);
    }

    // -----------------------------------------------------------------------
    // EditEntry (undo stack) msgpack round-trip
    // -----------------------------------------------------------------------

    #[test]
    fn edit_entry_msgpack_round_trip() {
        let old = loc_with_heading(1, 10.0, 20.0, 0.0);
        let new = loc_with_heading(1, 10.0, 20.0, 90.0);
        let entry = EditEntry { created: vec![new.clone()], removed: vec![old.clone()] };
        let bytes = rmp_serde::to_vec_named(&entry).unwrap();
        let restored: EditEntry = rmp_serde::from_slice(&bytes).unwrap();
        assert_eq!(restored.created[0], new);
        assert_eq!(restored.removed[0], old);
    }

    #[test]
    fn undo_stack_msgpack_round_trip() {
        let entries = vec![
            EditEntry { created: vec![loc(1, 10.0, 20.0)], removed: vec![] },
            EditEntry { created: vec![], removed: vec![loc(2, 30.0, 40.0)] },
            EditEntry { created: vec![loc_with_heading(3, 0.0, 0.0, 90.0)], removed: vec![loc(3, 0.0, 0.0)] },
        ];
        let bytes = rmp_serde::to_vec_named(&entries).unwrap();
        let restored: Vec<EditEntry> = rmp_serde::from_slice(&bytes).unwrap();
        assert_eq!(restored.len(), 3);
        assert_eq!(restored[0].created[0].lat, 10.0);
        assert_eq!(restored[1].removed[0].id, 2);
        assert_eq!(restored[2].created[0].heading, 90.0);
    }

    // -----------------------------------------------------------------------
    // Render buffer binary format
    // -----------------------------------------------------------------------

    // -----------------------------------------------------------------------
    // Cross-cutting invariants
    // -----------------------------------------------------------------------

    #[test]
    fn alive_count_stays_correct_through_all_mutations() {
        let mut store = setup_store_with(&[]);
        assert_eq!(store.alive_count, 0);

        // Add 3
        let locs = vec![loc(1, 0.0, 0.0), loc(2, 1.0, 1.0), loc(3, 2.0, 2.0)];
        for l in &locs { store.overlay_add(l.clone()); }
        assert_eq!(store.alive_count, 3);

        // Remove 1
        store.overlay_remove(&[locs[0].clone()]);
        assert_eq!(store.alive_count, 2);

        // Update (should not change count)
        store.overlay_update(2, &LocationPatch { heading: Some(90.0), ..patch() });
        assert_eq!(store.alive_count, 2);

        // Bake (should not change count)
        store.bake_overlay();
        assert_eq!(store.alive_count, 2);

        // Add 1 more
        store.overlay_add(loc(4, 3.0, 3.0));
        assert_eq!(store.alive_count, 3);

        // Remove 2
        let l2 = store.get_loc_by_id(2).unwrap();
        let l3 = store.get_loc_by_id(3).unwrap();
        store.overlay_remove(&[l2, l3]);
        assert_eq!(store.alive_count, 1);

        // Undo the remove (re-adds 2)
        let entry = EditEntry { created: vec![], removed: vec![loc(2, 1.0, 1.0), loc(3, 2.0, 2.0)] };
        apply_edit_reverse(&mut store, &entry);
        assert_eq!(store.alive_count, 3);
    }

    #[test]
    fn ids_are_never_reused() {
        let mut store = Store::new();
        let mut seen = std::collections::HashSet::new();
        for _ in 0..1000 {
            let id = store.alloc_id();
            assert!(!seen.contains(&id), "ID {} was reused", id);
            seen.insert(id);
        }
    }

    #[test]
    fn tag_ids_are_never_reused() {
        let mut store = Store::new();
        let mut seen = std::collections::HashSet::new();
        for _ in 0..1000 {
            let id = store.alloc_tag_id();
            assert!(!seen.contains(&id), "Tag ID {} was reused", id);
            seen.insert(id);
        }
    }

    #[test]
    fn overlay_consistency_no_id_in_both_dead_and_adds() {
        let l = loc(1, 10.0, 20.0);
        let mut store = setup_store_with(&[l.clone()]);
        store.bake_overlay();

        // Remove it
        store.overlay_remove(&[l.clone()]);
        assert!(store.overlay_dead.contains(&1));
        assert!(!store.overlay_adds.iter().any(|l| l.id == 1));

        // Re-add it (overlay_add on a known batch ID goes to patches)
        store.overlay_add(loc(1, 50.0, 60.0));
        // After re-add, it should NOT be in dead
        assert!(!store.overlay_dead.contains(&1), "re-added ID should be removed from dead set");
    }

    #[test]
    fn overlay_consistency_add_new_id_goes_to_adds() {
        let mut store = setup_store_with(&[]);
        store.batch = Some(empty_batch());
        store.overlay_add(loc(99, 10.0, 20.0));
        assert!(store.overlay_adds.iter().any(|l| l.id == 99));
        assert!(!store.overlay_patches.contains_key(&99));
    }

    #[test]
    fn overlay_consistency_update_batch_id_goes_to_patches() {
        let l = loc(1, 10.0, 20.0);
        let mut store = setup_store_with(&[l]);
        store.bake_overlay();
        // Now l is in the batch
        store.overlay_update(1, &LocationPatch { heading: Some(45.0), ..patch() });
        assert!(store.overlay_patches.contains_key(&1));
        assert!(!store.overlay_adds.iter().any(|l| l.id == 1));
    }

    #[test]
    fn overlay_consistency_update_add_id_stays_in_adds() {
        let mut store = setup_store_with(&[]);
        store.batch = Some(empty_batch());
        store.overlay_add(loc(1, 10.0, 20.0));
        store.overlay_update(1, &LocationPatch { heading: Some(45.0), ..patch() });
        // Should still be in overlay_adds, updated in place
        assert_eq!(store.overlay_adds.len(), 1);
        assert_eq!(store.overlay_adds[0].heading, 45.0);
        assert!(!store.overlay_patches.contains_key(&1));
    }

    #[test]
    fn overlay_consistency_remove_clears_patches() {
        let l = loc(1, 10.0, 20.0);
        let mut store = setup_store_with(&[l.clone()]);
        store.bake_overlay();
        store.overlay_update(1, &LocationPatch { heading: Some(45.0), ..patch() });
        assert!(store.overlay_patches.contains_key(&1));

        store.overlay_remove(&[l]);
        assert!(!store.overlay_patches.contains_key(&1), "remove should clear patches for the ID");
        assert!(store.overlay_dead.contains(&1));
    }

    #[test]
    fn render_buffer_format_matches_js_parser() {
        let l1 = loc_with_heading(1, 48.8, 2.35, 90.0);
        let l2 = loc(2, -33.8, 151.2);
        let mut store = setup_store_with(&[l1, l2]);
        store.bake_overlay();

        let req = RenderRequest {
            west: -180.0, south: -90.0, east: 180.0, north: 90.0,
            selected_ids: None,
            marker_style: "pin".into(),
        };
        let buf = build_cell_render_buffers(&mut store, &req);
        assert!(!buf.is_empty());

        // Parse the binary format the same way JS does
        let cell_count = u32::from_le_bytes(buf[0..4].try_into().unwrap());
        assert!(cell_count > 0, "should have at least one cell");

        let mut offset = 4usize;
        let mut total_locs = 0u32;
        for _ in 0..cell_count {
            let _cell_char = buf[offset];
            let count = u32::from_le_bytes(buf[offset+1..offset+5].try_into().unwrap());
            offset += 5;
            // ids: count * 4 bytes
            offset += count as usize * 4;
            // positions: count * 2 * 4 bytes
            offset += count as usize * 2 * 4;
            // colors: count * 4 bytes
            offset += count as usize * 4;
            // angles: count * 4 bytes
            offset += count as usize * 4;
            total_locs += count;
        }
        assert_eq!(total_locs, 2, "should have 2 locations total");

        // Selection overlay: u32 count
        let sel_count = u32::from_le_bytes(buf[offset..offset+4].try_into().unwrap());
        assert_eq!(sel_count, 0, "no selections active");
    }

    #[test]
    fn cell_render_id_order_matches_after_swap_remove_sequence() {
        // This test verifies the Rust side of the critical invariant:
        // after a sequence of adds and removes, CellRender.id_order[i]
        // must match what JS's CellBuffer.ids[i] would be after the same
        // sequence of applyDelta calls. Both use swap-remove.
        let mut store = setup_store_with(&[]);
        store.cell_add_render("s", 10);
        store.cell_add_render("s", 20);
        store.cell_add_render("s", 30);
        // order: [10, 20, 30]

        // Remove index 0 (id=10) — 30 swaps in
        store.cell_remove_render(10);
        let cr = store.render_cells.get("s").unwrap();
        assert_eq!(cr.id_order, vec![30, 20]);

        // Remove index 0 (id=30) — 20 swaps in
        store.cell_remove_render(30);
        let cr = store.render_cells.get("s").unwrap();
        assert_eq!(cr.id_order, vec![20]);

        // Add new entries
        store.cell_add_render("s", 40);
        store.cell_add_render("s", 50);
        let cr = store.render_cells.get("s").unwrap();
        assert_eq!(cr.id_order, vec![20, 40, 50]);

        // Verify index lookups
        assert_eq!(*cr.id_to_index.get(&20).unwrap(), 0);
        assert_eq!(*cr.id_to_index.get(&40).unwrap(), 1);
        assert_eq!(*cr.id_to_index.get(&50).unwrap(), 2);
    }

    // -----------------------------------------------------------------------
    // Bug regression: undo delete must re-add render entry
    // (e53e8f5, 66d82f1)
    // -----------------------------------------------------------------------

    #[test]
    fn undo_delete_readds_render_entry() {
        let l = loc(1, 10.0, 20.0);
        let mut store = setup_store_with(&[l.clone()]);
        assert!(store.cell_lookup(1).is_some());

        // Delete
        let entry = EditEntry { created: vec![], removed: vec![l.clone()] };
        let delta = apply_edit_forward(&mut store, &entry);
        assert_eq!(delta.removed.len(), 1);
        assert!(store.cell_lookup(1).is_none());

        // Undo delete
        let delta = apply_edit_reverse(&mut store, &entry);
        assert_eq!(delta.added.len(), 1);
        assert_eq!(delta.added[0].id, 1);
        assert!(store.cell_lookup(1).is_some(), "render entry must be restored after undo delete");
    }

    #[test]
    fn undo_delete_multiple_then_readd_renders_correctly() {
        let l1 = loc(1, 10.0, 20.0);
        let l2 = loc(2, 30.0, 40.0);
        let l3 = loc(3, 50.0, 60.0);
        let mut store = setup_store_with(&[l1.clone(), l2.clone(), l3.clone()]);

        // Delete l1 and l2
        let entry = EditEntry { created: vec![], removed: vec![l1.clone(), l2.clone()] };
        apply_edit_forward(&mut store, &entry);
        assert!(store.cell_lookup(1).is_none());
        assert!(store.cell_lookup(2).is_none());
        assert!(store.cell_lookup(3).is_some());

        // Undo
        let delta = apply_edit_reverse(&mut store, &entry);
        assert_eq!(delta.added.len(), 2);
        assert!(store.cell_lookup(1).is_some());
        assert!(store.cell_lookup(2).is_some());
        assert!(store.cell_lookup(3).is_some());
    }

    // -----------------------------------------------------------------------
    // Bug regression: selection state after clear
    // (c2be3d6)
    // -----------------------------------------------------------------------

    #[test]
    fn selected_ids_cleared_properly() {
        let mut store = setup_store_with(&[loc(1, 0.0, 0.0), loc(2, 0.0, 0.0)]);
        store.selected_ids.insert(1);
        store.selected_ids.insert(2);
        store.selected_colors.insert(1, [255, 0, 0]);
        store.selected_colors.insert(2, [0, 255, 0]);

        store.selected_ids.clear();
        store.selected_colors.clear();
        assert!(store.selected_ids.is_empty());
        assert!(store.selected_colors.is_empty());
    }

    // -----------------------------------------------------------------------
    // Bug regression: tag counts after bulk operations + undo
    // (edd45ab, TODO "tag counts are wrong")
    // -----------------------------------------------------------------------

    #[test]
    fn tag_counts_correct_after_bulk_add_then_undo() {
        let locs: Vec<LocationData> = (0..10)
            .map(|i| loc_with_tags(i, i as f64, 0.0, vec![5]))
            .collect();
        let mut store = setup_store_with(&locs);
        assert_eq!(store.tag_counts.get(&5), Some(&10));

        let entry = EditEntry { created: locs.clone(), removed: vec![] };
        apply_edit_reverse(&mut store, &entry);
        assert_eq!(store.tag_counts.get(&5), Some(&0));
        assert_eq!(store.alive_count, 0);

        apply_edit_forward(&mut store, &entry);
        assert_eq!(store.tag_counts.get(&5), Some(&10));
        assert_eq!(store.alive_count, 10);
    }

    #[test]
    fn tag_counts_correct_after_tag_reassignment_undo() {
        // location starts with tag [5], update to [5, 10], undo should restore [5]
        let old = loc_with_tags(1, 0.0, 0.0, vec![5]);
        let new = loc_with_tags(1, 0.0, 0.0, vec![5, 10]);
        let mut store = setup_store_with(&[new.clone()]);
        store.tag_counts.clear();
        store.add_tag_counts(&[new.clone()]);
        assert_eq!(store.tag_counts.get(&5), Some(&1));
        assert_eq!(store.tag_counts.get(&10), Some(&1));

        let entry = EditEntry { created: vec![new], removed: vec![old] };
        apply_edit_reverse(&mut store, &entry);
        assert_eq!(store.tag_counts.get(&5), Some(&1), "tag 5 should still be 1");
        assert_eq!(store.tag_counts.get(&10), Some(&0), "tag 10 should be 0 after undo");
    }

    // -----------------------------------------------------------------------
    // Bug regression: delta overlay preserves data through save/load
    // (759c448 "same location save bug")
    // -----------------------------------------------------------------------

    #[test]
    fn delta_overlay_only_includes_actual_changes() {
        let l1 = loc(1, 10.0, 20.0);
        let l2 = loc(2, 30.0, 40.0);
        let mut store = setup_store_with(&[l1.clone(), l2.clone()]);
        store.bake_overlay();

        // Modify only l1
        store.overlay_update(1, &LocationPatch { heading: Some(90.0), ..patch() });

        // Build delta overlay
        let overlay = DeltaOverlay {
            adds: store.overlay_adds.clone(),
            dead_ids: store.overlay_dead.iter().cloned().collect(),
            patches: store.overlay_patches.values().cloned().collect(),
        };
        assert!(overlay.adds.is_empty(), "no new locations added");
        assert!(overlay.dead_ids.is_empty(), "no locations deleted");
        assert_eq!(overlay.patches.len(), 1, "only modified location in patches");
        assert_eq!(overlay.patches[0].id, 1);
        assert_eq!(overlay.patches[0].heading, 90.0);
    }

    #[test]
    fn delta_overlay_round_trip_preserves_store_state() {
        let l1 = loc_with_tags(1, 10.0, 20.0, vec![5]);
        let l2 = loc(2, 30.0, 40.0);
        let mut store = setup_store_with(&[l1.clone(), l2.clone()]);
        store.bake_overlay();

        // Add l3, remove l1, patch l2
        let l3 = loc(3, 50.0, 60.0);
        store.overlay_add(l3.clone());
        store.alive_count += 1;
        store.overlay_remove(&[l1.clone()]);
        store.overlay_update(2, &LocationPatch { heading: Some(180.0), ..patch() });

        // Serialize
        let overlay = DeltaOverlay {
            adds: store.overlay_adds.clone(),
            dead_ids: store.overlay_dead.iter().cloned().collect(),
            patches: store.overlay_patches.values().cloned().collect(),
        };
        let bytes = rmp_serde::to_vec_named(&overlay).unwrap();

        // Simulate reopen: deserialize and verify
        let restored: DeltaOverlay = rmp_serde::from_slice(&bytes).unwrap();
        assert_eq!(restored.adds.len(), 1);
        assert_eq!(restored.adds[0].id, 3);
        assert!(restored.dead_ids.contains(&1));
        assert_eq!(restored.patches.len(), 1);
        assert_eq!(restored.patches[0].heading, 180.0);
    }

    // -----------------------------------------------------------------------
    // Bug regression: active location removed by undo
    // (5ac390a)
    // -----------------------------------------------------------------------

    #[test]
    fn active_id_should_be_clearable_when_location_removed() {
        let l = loc(1, 10.0, 20.0);
        let mut store = setup_store_with(&[l.clone()]);
        store.active_id = Some(1);

        // Remove the active location
        let entry = EditEntry { created: vec![], removed: vec![l] };
        apply_edit_forward(&mut store, &entry);

        // The caller (JS) should clear active_id when the delta removes it.
        // Verify the location is actually gone so the caller can detect it.
        assert!(store.get_loc_by_id(1).is_none());
        let delta_has_removed_active = entry.removed.iter().any(|l| Some(l.id) == store.active_id);
        assert!(delta_has_removed_active, "caller can detect active was removed");
    }

    // -----------------------------------------------------------------------
    // Render buffer binary format
    // -----------------------------------------------------------------------

    #[test]
    fn render_buffer_with_selection_overlay() {
        let l1 = loc(1, 10.0, 20.0);
        let l2 = loc(2, 30.0, 40.0);
        let mut store = setup_store_with(&[l1, l2]);
        store.bake_overlay();
        store.selected_ids.insert(1);
        store.selected_colors.insert(1, [255, 0, 0]);

        let req = RenderRequest {
            west: -180.0, south: -90.0, east: 180.0, north: 90.0,
            selected_ids: None,
            marker_style: "pin".into(),
        };
        let buf = build_cell_render_buffers(&mut store, &req);

        // Skip to selection overlay
        let cell_count = u32::from_le_bytes(buf[0..4].try_into().unwrap());
        let mut offset = 4usize;
        for _ in 0..cell_count {
            let count = u32::from_le_bytes(buf[offset+1..offset+5].try_into().unwrap()) as usize;
            offset += 5 + count * 4 + count * 2 * 4 + count * 4 + count * 4;
        }
        let sel_count = u32::from_le_bytes(buf[offset..offset+4].try_into().unwrap());
        assert_eq!(sel_count, 1, "one selected location");
    }
}

