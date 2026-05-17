pub fn hsl_to_rgb(h: f64, s: f64, l: f64) -> (u8, u8, u8) {
    let a = s * l.min(1.0 - l);
    let f = |n: f64| -> u8 {
        let k = (n + h / 30.0) % 12.0;
        (255.0 * (l - a * (k - 3.0).min(9.0 - k).min(1.0).max(-1.0))).round() as u8
    };
    (f(0.0), f(8.0), f(4.0))
}

pub fn color_for_name(name: &str) -> String {
    let mut h: i32 = 0;
    for b in name.bytes() {
        h = h.wrapping_add((b as i32).wrapping_add(h << 5));
    }
    h = h.wrapping_mul(214013).wrapping_add(2531011);
    let hue = (h.abs() % 360) as f64;
    let (r, g, b) = hsl_to_rgb(hue, 0.5, 0.5);
    format!("#{:02x}{:02x}{:02x}", r, g, b)
}

#[cfg(test)]
mod tests {
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
}
