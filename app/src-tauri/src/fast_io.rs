use rusqlite::Connection;
use sha2::{Digest, Sha256};
use tauri::ipc::InvokeBody;
use tauri::Manager;

pub fn is_test_mode() -> bool {
    cfg!(feature = "e2e") || std::env::var("MMA_TEST_DB").is_ok()
}

pub fn db_filename() -> &'static str {
    if is_test_mode() { "mma_test.db" } else { "mma.db" }
}

pub(crate) fn db_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|p| p.join(db_filename()))
        .map_err(|e| e.to_string())
}

pub(crate) fn open_db(app: &tauri::AppHandle) -> Result<Connection, String> {
    Connection::open(db_path(app)?).map_err(|e| e.to_string())
}

// ---------------------------------------------------------------------------
// Arrow IPC
// ---------------------------------------------------------------------------

pub(crate) fn arrow_dir(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let subdir = if is_test_mode() { "arrow_test" } else { "arrow" };
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?.join(subdir);
    if !dir.exists() {
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    }
    Ok(dir)
}

pub(crate) fn arrow_path(app: &tauri::AppHandle, map_id: &str) -> Result<std::path::PathBuf, String> {
    Ok(arrow_dir(app)?.join(format!("{map_id}.arrow")))
}

pub(crate) fn arrow_delta_path(app: &tauri::AppHandle, map_id: &str) -> Result<std::path::PathBuf, String> {
    Ok(arrow_dir(app)?.join(format!("{map_id}_delta.arrow")))
}

pub(crate) fn arrow_blobs_dir(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = arrow_dir(app)?.join("blobs");
    if !dir.exists() {
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    }
    Ok(dir)
}

pub(crate) fn blob_path(app: &tauri::AppHandle, hash: &str) -> Result<std::path::PathBuf, String> {
    Ok(arrow_blobs_dir(app)?.join(format!("{hash}.arrow")))
}

pub(crate) fn write_blob(app: &tauri::AppHandle, batch: &arrow::array::RecordBatch) -> Result<(String, usize), String> {
    let mut buf = Vec::new();
    {
        let cursor = std::io::Cursor::new(&mut buf);
        let mut writer = arrow::ipc::writer::FileWriter::try_new(cursor, &batch.schema())
            .map_err(|e| e.to_string())?;
        writer.write(batch).map_err(|e| e.to_string())?;
        writer.finish().map_err(|e| e.to_string())?;
    }
    let hash = sha256_hex(&buf);
    let path = blob_path(app, &hash)?;
    if !path.exists() {
        atomic_write(&path, |mut file| {
            use std::io::Write;
            file.write_all(&buf).map_err(|e| e.to_string())
        })?;
    }
    let rows = batch.num_rows();
    Ok((hash, rows))
}

pub(crate) fn read_blob(app: &tauri::AppHandle, hash: &str) -> Result<arrow::array::RecordBatch, String> {
    let path = blob_path(app, hash)?;
    read_arrow_ipc(&path)
}

pub(crate) fn write_arrow_ipc(path: &std::path::Path, batch: &arrow::array::RecordBatch) -> Result<(), String> {
    atomic_write(path, |file| {
        let buf = std::io::BufWriter::with_capacity(1 << 20, file);
        let mut writer = arrow::ipc::writer::FileWriter::try_new(buf, &batch.schema())
            .map_err(|e| e.to_string())?;
        writer.write(batch).map_err(|e| e.to_string())?;
        writer.finish().map_err(|e| e.to_string())?;
        Ok(())
    })
}

pub(crate) fn atomic_write(path: &std::path::Path, write_fn: impl FnOnce(std::fs::File) -> Result<(), String>) -> Result<(), String> {
    let tmp = path.with_extension("tmp");
    let file = std::fs::File::create(&tmp).map_err(|e| e.to_string())?;
    write_fn(file)?;
    std::fs::rename(&tmp, path).map_err(|e| e.to_string())?;
    Ok(())
}

pub(crate) fn read_arrow_ipc(path: &std::path::Path) -> Result<arrow::array::RecordBatch, String> {
    let file = std::fs::File::open(path).map_err(|e| e.to_string())?;
    let reader = arrow::ipc::reader::FileReader::try_new(file, None)
        .map_err(|e| e.to_string())?;
    let mut batches = Vec::new();
    for batch in reader {
        batches.push(batch.map_err(|e| e.to_string())?);
    }
    if batches.is_empty() {
        return Ok(arrow::array::RecordBatch::new_empty(std::sync::Arc::new(
            crate::arrow_bridge::location_schema(),
        )));
    }
    if batches.len() == 1 {
        return Ok(batches.into_iter().next().unwrap());
    }
    let schema = std::sync::Arc::new(crate::arrow_bridge::location_schema());
    arrow::compute::concat_batches(&schema, &batches).map_err(|e| e.to_string())
}


/// Returns msgpack map `{ undoStack: [...], redoStack: [...] }`.
// #[tauri::command]
// pub fn load_edit_history(app: tauri::AppHandle, map_id: String) -> Result<Response, String> {
//     let conn = open_db(&app)?;
//     let result = conn.query_row(
//         "SELECT undo_stack, redo_stack FROM edit_history WHERE map_id = ?1",
//         [&map_id],
//         |row| Ok((row.get::<_, Vec<u8>>(0)?, row.get::<_, Vec<u8>>(1)?)),
//     );

//     match result {
//         Ok((undo, redo)) => {
//             let mut out = Vec::with_capacity(undo.len() + redo.len() + 32);
//             out.push(0x82); // fixmap 2
//             write_fixstr(&mut out, "undoStack");
//             out.extend_from_slice(&undo);
//             write_fixstr(&mut out, "redoStack");
//             out.extend_from_slice(&redo);
//             Ok(Response::new(out))
//         }
//         Err(rusqlite::Error::QueryReturnedNoRows) => {
//             let mut out = Vec::new();
//             out.push(0x82); // fixmap 2
//             write_fixstr(&mut out, "undoStack");
//             out.push(0x90); // fixarray 0
//             write_fixstr(&mut out, "redoStack");
//             out.push(0x90);
//             Ok(Response::new(out))
//         }
//         Err(e) => Err(e.to_string()),
//     }
// }

// ---------------------------------------------------------------------------
// Save
// ---------------------------------------------------------------------------

#[derive(Clone, Debug, PartialEq, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LocationData {
    #[serde(default)]
    pub id: u32,
    pub lat: f64,
    pub lng: f64,
    pub heading: f64,
    pub pitch: f64,
    pub zoom: f64,
    pub pano_id: Option<String>,
    pub flags: u32,
    pub tags: Vec<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub extra: Option<serde_json::Map<String, serde_json::Value>>,
    pub created_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub modified_at: Option<String>,
}

pub(crate) fn sha256_hex(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    let mut s = String::with_capacity(digest.len() * 2);
    for b in digest.iter() {
        use std::fmt::Write;
        write!(&mut s, "{:02x}", b).unwrap();
    }
    s
}

// #[derive(serde::Deserialize)]
// #[serde(rename_all = "camelCase")]
// struct SaveHistoryPayload {
//     map_id: String,
//     undo_stack: serde_json::Value,
//     redo_stack: serde_json::Value,
// }

/// Receive msgpack `{ mapId, undoStack, redoStack }`, re-encode each stack
/// as a separate msgpack blob, and write to edit_history.
// #[tauri::command]
// pub async fn save_edit_history(app: tauri::AppHandle, request: tauri::ipc::Request<'_>) -> Result<(), String> {
//     let body = raw_body(&request)?.to_vec();
//     let db_path = db_path(&app)?;
//     tokio::task::spawn_blocking(move || {
//         let conn = Connection::open(&db_path).map_err(|e| e.to_string())?;
//         let p: SaveHistoryPayload = rmp_serde::from_slice(&body).map_err(|e| e.to_string())?;
//         let undo = rmp_serde::to_vec(&p.undo_stack).map_err(|e| e.to_string())?;
//         let redo = rmp_serde::to_vec(&p.redo_stack).map_err(|e| e.to_string())?;
//         conn.execute(
//             "INSERT OR REPLACE INTO edit_history (map_id, undo_stack, redo_stack) VALUES (?1, ?2, ?3)",
//             rusqlite::params![p.map_id, undo, redo],
//         )
//         .map_err(|e| e.to_string())?;
//         Ok(())
//     }).await.map_err(|e| e.to_string())?
// }

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn raw_body<'a>(req: &'a tauri::ipc::Request<'a>) -> Result<&'a [u8], String> {
    match req.body() {
        InvokeBody::Raw(b) => Ok(b),
        _ => Err("expected binary request body".into()),
    }
}


fn write_fixstr(out: &mut Vec<u8>, s: &str) {
    assert!(s.len() <= 31);
    out.push(0xa0 | s.len() as u8);
    out.extend_from_slice(s.as_bytes());
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_loc() -> LocationData {
        LocationData {
            id: 42,
            lat: 48.8566,
            lng: 2.3522,
            heading: 90.0,
            pitch: 5.0,
            zoom: 1.5,
            pano_id: Some("CAoSLEF".into()),
            flags: 1,
            tags: vec![1, 2, 3],
            extra: Some(serde_json::from_str(r#"{"country":"FR"}"#).unwrap()),
            created_at: "2024-01-15T10:30:00Z".into(),
            modified_at: Some("2024-01-15T11:00:00Z".into()),
        }
    }

    #[test]
    fn location_data_serde_round_trip() {
        let loc = sample_loc();
        let json = serde_json::to_string(&loc).unwrap();
        let restored: LocationData = serde_json::from_str(&json).unwrap();
        assert_eq!(loc, restored);
    }

    #[test]
    fn location_data_null_optionals() {
        let loc = LocationData {
            id: 1, lat: 0.0, lng: 0.0, heading: 0.0, pitch: 0.0, zoom: 0.0,
            pano_id: None, flags: 0, tags: vec![], extra: None,
            created_at: String::new(), modified_at: None,
        };
        let json = serde_json::to_string(&loc).unwrap();
        assert!(!json.contains("extra"));
        assert!(!json.contains("modifiedAt"));
        let restored: LocationData = serde_json::from_str(&json).unwrap();
        assert_eq!(loc, restored);
    }

    #[test]
    fn location_data_id_defaults_to_zero() {
        let json = r#"{"lat":0,"lng":0,"heading":0,"pitch":0,"zoom":0,"panoId":null,"flags":0,"tags":[],"createdAt":""}"#;
        let loc: LocationData = serde_json::from_str(json).unwrap();
        assert_eq!(loc.id, 0);
    }

    #[test]
    fn sha256_hex_deterministic() {
        let a = sha256_hex(b"hello");
        let b = sha256_hex(b"hello");
        assert_eq!(a, b);
    }

    #[test]
    fn sha256_hex_length() {
        let h = sha256_hex(b"test");
        assert_eq!(h.len(), 64);
    }

    #[test]
    fn sha256_hex_known_value() {
        // sha256("") = e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
        let h = sha256_hex(b"");
        assert_eq!(h, "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    }

    #[test]
    fn sha256_hex_differs_for_different_input() {
        assert_ne!(sha256_hex(b"hello"), sha256_hex(b"world"));
    }
}
