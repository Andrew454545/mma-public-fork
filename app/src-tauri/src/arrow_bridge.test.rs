use super::*;

fn sample_locations() -> Vec<Location> {
    vec![
        Location {
            id: 1,
            lat: 48.8566,
            lng: 2.3522,
            heading: 90.0,
            pitch: 5.0,
            zoom: 1.5,
            pano_id: Some("CAoSLEF...".to_string()),
            flags: crate::types::LocationFlags::LOAD_AS_PANO_ID,
            tags: vec![1, 2],
            extra: Some(serde_json::from_str(r#"{"countryCode":"FR","altitude":35.2}"#).unwrap()),
            created_at: "2024-01-15T10:30:00Z".to_string(),
            modified_at: Some("2024-01-15T11:00:00Z".to_string()),
        },
        Location {
            id: 2,
            lat: -33.8688,
            lng: 151.2093,
            heading: 0.0,
            pitch: 0.0,
            zoom: 1.0,
            pano_id: None,
            flags: crate::types::LocationFlags::empty(),
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
