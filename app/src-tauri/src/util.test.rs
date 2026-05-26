use super::*;

#[test]
fn hsl_pure_red() {
    let (r, g, b) = hsl_to_rgb(0.0, 1.0, 0.5);
    assert_eq!(r, 255);
    assert_eq!(g, 0);
    assert_eq!(b, 0);
}

#[test]
fn hsl_pure_green() {
    let (r, g, b) = hsl_to_rgb(120.0, 1.0, 0.5);
    assert_eq!(r, 0);
    assert_eq!(g, 255);
    assert_eq!(b, 0);
}

#[test]
fn hsl_pure_blue() {
    let (r, g, b) = hsl_to_rgb(240.0, 1.0, 0.5);
    assert_eq!(r, 0);
    assert_eq!(g, 0);
    assert_eq!(b, 255);
}

#[test]
fn hsl_white() {
    let (r, g, b) = hsl_to_rgb(0.0, 0.0, 1.0);
    assert_eq!((r, g, b), (255, 255, 255));
}

#[test]
fn hsl_black() {
    let (r, g, b) = hsl_to_rgb(0.0, 0.0, 0.0);
    assert_eq!((r, g, b), (0, 0, 0));
}

#[test]
fn hsl_mid_gray() {
    let (r, g, b) = hsl_to_rgb(0.0, 0.0, 0.5);
    assert_eq!(r, g);
    assert_eq!(g, b);
    assert_eq!(r, 128);
}

#[test]
fn color_for_name_returns_hex() {
    let c = color_for_name("test");
    assert!(c.starts_with('#'));
    assert_eq!(c.len(), 7);
}

#[test]
fn color_for_name_deterministic() {
    assert_eq!(color_for_name("hello"), color_for_name("hello"));
}

#[test]
fn color_for_name_varies() {
    assert_ne!(color_for_name("alpha"), color_for_name("beta"));
}

#[test]
fn hex_to_rgb_with_hash() {
    assert_eq!(hex_to_rgb("#ff8800"), Some([255, 136, 0]));
}

#[test]
fn hex_to_rgb_without_hash() {
    assert_eq!(hex_to_rgb("00ff00"), Some([0, 255, 0]));
}

#[test]
fn hex_to_rgb_black() {
    assert_eq!(hex_to_rgb("#000000"), Some([0, 0, 0]));
}

#[test]
fn hex_to_rgb_white() {
    assert_eq!(hex_to_rgb("#ffffff"), Some([255, 255, 255]));
}

#[test]
fn hex_to_rgb_invalid_length() {
    assert_eq!(hex_to_rgb("#fff"), None);
    assert_eq!(hex_to_rgb(""), None);
}

#[test]
fn hex_to_rgb_invalid_chars() {
    assert_eq!(hex_to_rgb("#gggggg"), None);
}

#[test]
fn iso_unix_epoch() {
    assert_eq!(iso_to_unix("1970-01-01T00:00:00Z"), Some(0.0));
}

#[test]
fn iso_known_date() {
    let ts = iso_to_unix("2024-01-01T00:00:00Z").unwrap();
    assert_eq!(ts, 1704067200.0);
}

#[test]
fn iso_invalid_returns_none() {
    assert!(iso_to_unix("not-a-date").is_none());
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
    let h = sha256_hex(b"");
    assert_eq!(h, "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
}

#[test]
fn sha256_hex_differs_for_different_input() {
    assert_ne!(sha256_hex(b"hello"), sha256_hex(b"world"));
}
