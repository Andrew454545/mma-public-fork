use reverse_geocoder::{ReverseGeocoder, SearchResult};
use serde::Serialize;
use std::sync::OnceLock;

static GEOCODER: OnceLock<ReverseGeocoder> = OnceLock::new();

fn get_geocoder() -> &'static ReverseGeocoder {
    GEOCODER.get_or_init(ReverseGeocoder::new)
}

#[derive(Serialize)]
pub struct GeoResult {
    pub city: String,
    pub admin: String,
    pub country: String,
    pub country_code: String,
}

impl From<&SearchResult<'_>> for GeoResult {
    fn from(r: &SearchResult<'_>) -> Self {
        Self {
            city: r.record.name.to_string(),
            admin: r.record.admin1.to_string(),
            country: r.record.cc.to_string(),
            country_code: r.record.cc.to_string(),
        }
    }
}

#[tauri::command]
pub fn reverse_geocode(lat: f64, lng: f64) -> Option<GeoResult> {
    let gc = get_geocoder();
    let result = gc.search((lat, lng));
    Some(GeoResult::from(&result))
}
