// ----------------------------------------------------------------------------
// The holes the page asks for in mpv's window, as rectangles a window system
// can subtract.
//
// Shared by the two backends whose picture paints *over* the page — X11
// (player.rs) and Win32 (player_windows.rs). Everything the controls float on
// is rounded, and a hole cut square around a rounded panel shows the page
// behind it in each corner: four black notches against the film, which is what
// the subtitle panel looked like on Windows. So a hole carries the radius of
// the thing it is for, and the corners are cut to match.
//
// Worked out here rather than with each system's own rounded region: X has
// none — a region there is a list of rectangles — and one shape computed in one
// place is one shape on both, held by a test that runs on any machine.
// ----------------------------------------------------------------------------

/// A rectangle of the video window the frontend wants punched out, in physical
/// pixels relative to the video box's top-left, with the corner radius of the
/// control it makes room for.
#[derive(serde::Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
pub struct Cutout {
	pub x: i32,
	pub y: i32,
	pub width: u32,
	pub height: u32,
	/// Absent from an older frontend, which meant square.
	#[serde(default)]
	pub radius: u32,
}

/// One rectangle of a hole: x, y, width, height.
pub type Strip = (i32, i32, u32, u32);

impl Cutout {
	/// The hole as rectangles whose union is it: the straight middle, and above
	/// and below it one band per run of rows that the corners' quarter circles
	/// stand in by the same amount. A square hole is a single strip.
	///
	/// A pixel is in when its centre is inside the circle, so the edge is the
	/// one the browser's own antialiased curve sits on, and the film covers its
	/// outermost fringe rather than the page showing round it.
	pub fn strips(&self) -> Vec<Strip> {
		let (w, h) = (self.width, self.height);
		if w == 0 || h == 0 {
			return Vec::new();
		}
		// A pill: `rounded-full` arrives as an enormous radius.
		let r = self.radius.min(w / 2).min(h / 2);
		if r == 0 {
			return vec![(self.x, self.y, w, h)];
		}
		let rf = f64::from(r);
		let inset = |row: u32| {
			let dy = rf - f64::from(row) - 0.5;
			(rf - 0.5 - (rf * rf - dy * dy).sqrt()).ceil().max(0.0) as u32
		};

		let mut out = Vec::new();
		let mut row = 0;
		while row < r {
			let i = inset(row);
			let mut end = row + 1;
			while end < r && inset(end) == i {
				end += 1;
			}
			let rows = end - row;
			out.push((self.x + i as i32, self.y + row as i32, w - 2 * i, rows));
			out.push((self.x + i as i32, self.y + (h - end) as i32, w - 2 * i, rows));
			row = end;
		}
		if h > 2 * r {
			out.push((self.x, self.y + r as i32, w, h - 2 * r));
		}
		out
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	fn cut(width: u32, height: u32, radius: u32) -> Cutout {
		Cutout { x: 10, y: 20, width, height, radius }
	}

	/// Every pixel of the hole, so shapes can be compared cell by cell.
	fn cells(strips: &[Strip]) -> Vec<(i32, i32)> {
		let mut out: Vec<(i32, i32)> = strips
			.iter()
			.flat_map(|&(x, y, w, h)| {
				(y..y + h as i32).flat_map(move |py| (x..x + w as i32).map(move |px| (px, py)))
			})
			.collect();
		let before = out.len();
		out.sort_unstable();
		out.dedup();
		assert_eq!(before, out.len(), "strips overlap");
		out
	}

	#[test]
	fn a_square_hole_is_one_rectangle() {
		assert_eq!(cut(300, 200, 0).strips(), vec![(10, 20, 300, 200)]);
	}

	#[test]
	fn an_empty_hole_is_nothing() {
		assert!(cut(0, 40, 8).strips().is_empty());
		assert!(cut(40, 0, 8).strips().is_empty());
	}

	#[test]
	fn the_corners_are_cut_and_the_edges_are_not() {
		let c = cut(360, 448, 12);
		let px = cells(&c.strips());
		let has = |x: i32, y: i32| px.binary_search(&(x, y)).is_ok();
		// The very corners stay the film's…
		for (x, y) in [(10, 20), (369, 20), (10, 467), (369, 467)] {
			assert!(!has(x, y), "corner ({x}, {y}) is cut");
		}
		// …the middle of every edge is the hole's…
		for (x, y) in [(190, 20), (190, 467), (10, 244), (369, 244)] {
			assert!(has(x, y), "edge ({x}, {y}) is not");
		}
		// …and so is everything a radius in from the corners.
		for (x, y) in [(22, 32), (357, 32), (22, 455), (357, 455)] {
			assert!(has(x, y), "({x}, {y}) inside the curve is not");
		}
		// Nothing outside the rectangle it was asked for.
		assert!(px.iter().all(|&(x, y)| (10..370).contains(&x) && (20..468).contains(&y)));
	}

	#[test]
	fn the_shape_is_symmetric() {
		let c = cut(101, 57, 14);
		let px = cells(&c.strips());
		for &(x, y) in &px {
			let mx = 10 + 100 - (x - 10);
			let my = 20 + 56 - (y - 20);
			assert!(px.binary_search(&(mx, y)).is_ok(), "not mirrored left to right at ({x}, {y})");
			assert!(px.binary_search(&(x, my)).is_ok(), "not mirrored top to bottom at ({x}, {y})");
		}
	}

	#[test]
	fn the_area_is_a_rounded_rectangles() {
		let (w, h, r) = (400u32, 300u32, 24u32);
		let area = cells(&cut(w, h, r).strips()).len() as f64;
		let expected = f64::from(w * h) - (4.0 - std::f64::consts::PI) * f64::from(r * r);
		assert!((area - expected).abs() < f64::from(r) * 4.0, "{area} against {expected}");
	}

	#[test]
	fn a_huge_radius_is_a_pill() {
		let pill = cut(200, 40, 1 << 30);
		assert_eq!(pill.strips(), cut(200, 40, 20).strips());
		let px = cells(&pill.strips());
		assert!(px.binary_search(&(10, 40)).is_ok(), "the end of a pill reaches its edge at mid-height");
		assert!(px.binary_search(&(10, 20)).is_err(), "and not at its corner");
	}

	#[test]
	fn rows_that_stand_in_alike_share_a_strip() {
		// A big radius would otherwise be a strip per row of it, per corner band.
		let strips = cut(800, 600, 48).strips();
		assert!(strips.len() < 2 * 48, "{} strips", strips.len());
	}

	#[test]
	fn an_older_frontend_without_a_radius_still_parses() {
		let c: Cutout = serde_json::from_str(r#"{"x":1,"y":2,"width":3,"height":4}"#).unwrap();
		assert_eq!(c, Cutout { x: 1, y: 2, width: 3, height: 4, radius: 0 });
	}
}
