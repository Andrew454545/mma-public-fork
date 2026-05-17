use std::sync::Arc;

use arrow::array::{
    Array, ArrayRef, Float64Array, GenericListBuilder, ListArray, RecordBatch,
    StringArray, UInt32Array, UInt32Builder,
};
use arrow::datatypes::{DataType, Field, Schema};

use crate::fast_io::LocationData;

pub fn location_schema() -> Schema {
    Schema::new(vec![
        Field::new("id", DataType::UInt32, false),
        Field::new("lat", DataType::Float64, false),
        Field::new("lng", DataType::Float64, false),
        Field::new("heading", DataType::Float64, false),
        Field::new("pitch", DataType::Float64, false),
        Field::new("zoom", DataType::Float64, false),
        Field::new("pano_id", DataType::Utf8, true),
        Field::new("flags", DataType::UInt32, false),
        Field::new(
            "tags",
            DataType::List(Arc::new(Field::new("item", DataType::UInt32, true))),
            false,
        ),
        Field::new("extra", DataType::Utf8, true),
        Field::new("created_at", DataType::Utf8, false),
        Field::new("modified_at", DataType::Utf8, true),
    ])
}

pub fn locations_to_batch(locs: &[LocationData]) -> RecordBatch {
    let n = locs.len();

    let ids = UInt32Array::from(locs.iter().map(|l| l.id).collect::<Vec<_>>());
    let lats = Float64Array::from(locs.iter().map(|l| l.lat).collect::<Vec<_>>());
    let lngs = Float64Array::from(locs.iter().map(|l| l.lng).collect::<Vec<_>>());
    let headings = Float64Array::from(locs.iter().map(|l| l.heading).collect::<Vec<_>>());
    let pitches = Float64Array::from(locs.iter().map(|l| l.pitch).collect::<Vec<_>>());
    let zooms = Float64Array::from(locs.iter().map(|l| l.zoom).collect::<Vec<_>>());
    let pano_ids: StringArray = locs
        .iter()
        .map(|l| l.pano_id.as_deref())
        .collect();
    let flags = UInt32Array::from(locs.iter().map(|l| l.flags).collect::<Vec<_>>());

    let mut tags_builder =
        GenericListBuilder::<i32, UInt32Builder>::with_capacity(UInt32Builder::new(), n);
    for loc in locs {
        let values = tags_builder.values();
        for &tag in &loc.tags {
            values.append_value(tag);
        }
        tags_builder.append(true);
    }
    let tags = tags_builder.finish();

    let extras: StringArray = locs
        .iter()
        .map(|l| l.extra.as_ref().map(|e| serde_json::to_string(e).unwrap()))
        .collect();

    let created_ats: StringArray = locs.iter().map(|l| Some(l.created_at.as_str())).collect();
    let modified_ats: StringArray = locs.iter().map(|l| l.modified_at.as_deref()).collect();

    let schema = Arc::new(location_schema());
    let columns: Vec<ArrayRef> = vec![
        Arc::new(ids),
        Arc::new(lats),
        Arc::new(lngs),
        Arc::new(headings),
        Arc::new(pitches),
        Arc::new(zooms),
        Arc::new(pano_ids),
        Arc::new(flags),
        Arc::new(tags),
        Arc::new(extras),
        Arc::new(created_ats),
        Arc::new(modified_ats),
    ];

    RecordBatch::try_new(schema, columns).expect("schema matches columns")
}

pub fn row_to_location(batch: &RecordBatch, idx: usize) -> LocationData {
    let id = batch
        .column(0)
        .as_any()
        .downcast_ref::<UInt32Array>()
        .unwrap()
        .value(idx);
    let lat = batch.column(1).as_any().downcast_ref::<Float64Array>().unwrap().value(idx);
    let lng = batch.column(2).as_any().downcast_ref::<Float64Array>().unwrap().value(idx);
    let heading = batch.column(3).as_any().downcast_ref::<Float64Array>().unwrap().value(idx);
    let pitch = batch.column(4).as_any().downcast_ref::<Float64Array>().unwrap().value(idx);
    let zoom = batch.column(5).as_any().downcast_ref::<Float64Array>().unwrap().value(idx);
    let pano_id_col = batch.column(6).as_any().downcast_ref::<StringArray>().unwrap();
    let pano_id = if pano_id_col.is_null(idx) {
        None
    } else {
        Some(pano_id_col.value(idx).to_string())
    };
    let flags = batch.column(7).as_any().downcast_ref::<UInt32Array>().unwrap().value(idx);
    let tags_col = batch.column(8).as_any().downcast_ref::<ListArray>().unwrap();
    let tags_arr = tags_col.value(idx);
    let tags_u32 = tags_arr.as_any().downcast_ref::<UInt32Array>().unwrap();
    let tags: Vec<u32> = (0..tags_u32.len()).map(|i| tags_u32.value(i)).collect();
    let extra_col = batch.column(9).as_any().downcast_ref::<StringArray>().unwrap();
    let extra = if extra_col.is_null(idx) {
        None
    } else {
        serde_json::from_str(extra_col.value(idx)).ok()
    };
    let created_at = batch
        .column(10)
        .as_any()
        .downcast_ref::<StringArray>()
        .unwrap()
        .value(idx)
        .to_string();
    let modified_at = {
        let col = batch.column(11).as_any().downcast_ref::<StringArray>().unwrap();
        if col.is_null(idx) { None } else { Some(col.value(idx).to_string()) }
    };

    LocationData {
        id,
        lat,
        lng,
        heading,
        pitch,
        zoom,
        pano_id,
        flags,
        tags,
        extra,
        created_at,
        modified_at,
    }
}

pub fn batch_to_locations(batch: &RecordBatch) -> Vec<LocationData> {
    (0..batch.num_rows()).map(|i| row_to_location(batch, i)).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_locations() -> Vec<LocationData> {
        vec![
            LocationData {
                id: 1,
                lat: 48.8566,
                lng: 2.3522,
                heading: 90.0,
                pitch: 5.0,
                zoom: 1.5,
                pano_id: Some("CAoSLEF...".to_string()),
                flags: 1,
                tags: vec![1, 2],
                extra: Some(serde_json::from_str(r#"{"countryCode":"FR","altitude":35.2}"#).unwrap()),
                created_at: "2024-01-15T10:30:00Z".to_string(),
                modified_at: Some("2024-01-15T11:00:00Z".to_string()),
            },
            LocationData {
                id: 2,
                lat: -33.8688,
                lng: 151.2093,
                heading: 0.0,
                pitch: 0.0,
                zoom: 1.0,
                pano_id: None,
                flags: 0,
                tags: vec![],
                extra: None,
                created_at: "2024-06-20T15:00:00Z".to_string(),
                modified_at: None,
            },
        ]
    }

    #[test]
    fn round_trip() {
        let locs = sample_locations();
        let batch = locations_to_batch(&locs);
        assert_eq!(batch.num_rows(), 2);
        assert_eq!(batch.num_columns(), 12);

        let restored = batch_to_locations(&batch);
        assert_eq!(restored.len(), 2);

        for (orig, rest) in locs.iter().zip(restored.iter()) {
            assert_eq!(orig.id, rest.id);
            assert!((orig.lat - rest.lat).abs() < 1e-10);
            assert!((orig.lng - rest.lng).abs() < 1e-10);
            assert!((orig.heading - rest.heading).abs() < 1e-10);
            assert!((orig.pitch - rest.pitch).abs() < 1e-10);
            assert!((orig.zoom - rest.zoom).abs() < 1e-10);
            assert_eq!(orig.pano_id, rest.pano_id);
            assert_eq!(orig.flags, rest.flags);
            assert_eq!(orig.tags, rest.tags);
            assert_eq!(
                orig.extra.as_ref().map(|e| serde_json::to_string(e).unwrap()),
                rest.extra.as_ref().map(|e| serde_json::to_string(e).unwrap()),
            );
            assert_eq!(orig.created_at, rest.created_at);
        }
    }

    #[test]
    fn empty_batch() {
        let batch = locations_to_batch(&[]);
        assert_eq!(batch.num_rows(), 0);
        let restored = batch_to_locations(&batch);
        assert!(restored.is_empty());
    }

    #[test]
    fn single_row_access() {
        let locs = sample_locations();
        let batch = locations_to_batch(&locs);
        let loc = row_to_location(&batch, 1);
        assert_eq!(loc.id, locs[1].id);
        assert_eq!(loc.pano_id, None);
        assert!(loc.tags.is_empty());
        assert!(loc.extra.is_none());
    }
}
