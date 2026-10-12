//! PPS Designer's bridge from JavaScript to the DesignCraft engine.
//!
//! A thin `wasm-bindgen` layer over upstream's public API, nothing more: every user action is an
//! engine command (`Session::execute`, with undo), pages are drawn by `Renderer::render_page`, and
//! the print file comes from the engine's own `file.exportPdf`. No engine logic lives here.
//!
//! Rules (CLAUDE.md, brief §5):
//! - Every export returns a `Result`; nothing panics. A panic in wasm takes the customer's design
//!   with it.
//! - Every input is hostile: JSON comes from a page and numbers from pointer events, so they are
//!   parsed, range-checked and refused rather than trusted.
//!
//! The logic is in [`Bridge`], which returns `Result<_, String>` and is tested natively;
//! [`Designer`] only converts its errors into JavaScript exceptions.
#![deny(clippy::unwrap_used, clippy::expect_used, clippy::panic, clippy::unimplemented, clippy::todo, clippy::unreachable)]

use base64::Engine as _;
use base64::engine::general_purpose::STANDARD as B64;
use designcraft_engine::Session;
use designcraft_render::Renderer;
use serde_json::{Value, json};
use wasm_bindgen::prelude::*;

/// Render scale limits in pixels per point. 8 px/pt is 576 dpi, beyond any screen preview; the
/// floor keeps a zero or negative scale from reaching the renderer.
const MIN_SCALE: f64 = 0.02;
const MAX_SCALE: f64 = 8.0;
/// The largest rendered page, in pixels, so a hostile scale on a large page cannot exhaust memory.
const MAX_PIXELS: f64 = 40_000_000.0;
/// The largest image the bridge will place (bytes). Phone photos are 3–12 MB.
const MAX_IMAGE_BYTES: usize = 40 * 1024 * 1024;
/// The largest design file the bridge will open (bytes).
const MAX_FILE_BYTES: usize = 100 * 1024 * 1024;
/// The first 16 bytes of every InDesign document (.indd, .indt), a published file signature.
const INDD_SIGNATURE: [u8; 16] = [0x06, 0x06, 0xED, 0xF5, 0xD8, 0x1D, 0x46, 0xE5, 0xBD, 0x31, 0xEF, 0xE7, 0xFE, 0x74, 0xB7, 0x1D];
/// The error `open_file` gives for an InDesign document, so the page can explain what to do.
pub const INDD_UNSUPPORTED: &str = "indd-unsupported";

/// Whether `bytes` (named `name`) is an InDesign document rather than an IDML package.
pub fn is_indd(bytes: &[u8], name: &str) -> bool {
    bytes.get(..16) == Some(&INDD_SIGNATURE[..]) || {
        let n = name.to_ascii_lowercase();
        n.ends_with(".indd") || n.ends_with(".indt")
    }
}

/// A rendered page: straight (not premultiplied) RGBA, ready for canvas `ImageData`.
#[derive(Debug)]
pub struct Rendered {
    pub width: u32,
    pub height: u32,
    pub rgba: Vec<u8>,
}

/// The engine session and renderer, with errors as strings.
pub struct Bridge {
    session: Session,
    renderer: Renderer,
}

impl Default for Bridge {
    fn default() -> Self {
        Self::new()
    }
}

impl Bridge {
    pub fn new() -> Self {
        let mut renderer = Renderer::new();
        // The browser gives wasm no threads; render on the calling one.
        renderer.threads = 0;
        Bridge { session: Session::new(), renderer }
    }

    /// Run one engine command. `params` is a JSON object (or empty for none).
    pub fn execute(&mut self, command: &str, params: &str) -> Result<Value, String> {
        if command.is_empty() || command.len() > 128 {
            return Err("execute: a command id is required".into());
        }
        let params: Value = if params.trim().is_empty() {
            json!({})
        } else {
            serde_json::from_str(params).map_err(|e| format!("execute {command}: params are not JSON: {e}"))?
        };
        if !params.is_object() {
            return Err(format!("execute {command}: params must be a JSON object"));
        }
        self.session.execute(command, &params).map_err(|e| format!("{command}: {e}"))
    }

    /// Draw page `page` (0-based, document order) at `scale` pixels per point.
    pub fn render_page(&mut self, page: usize, scale: f64, bleed: bool) -> Result<Rendered, String> {
        if !scale.is_finite() || !(MIN_SCALE..=MAX_SCALE).contains(&scale) {
            return Err(format!("renderPage: scale {scale} is outside {MIN_SCALE}..{MAX_SCALE}"));
        }
        let state = self.session.doc().map_err(|e| format!("renderPage: {e}"))?;
        let doc = state.doc.clone();
        // Refuse a render whose pixel count would be unreasonable before allocating it.
        let (w, h) = (doc.settings.page_width, doc.settings.page_height);
        let pad = if bleed { 2.0 * doc.settings.bleed.iter().copied().fold(0.0_f64, f64::max) } else { 0.0 };
        let px = (w + pad) * scale * (h + pad) * scale;
        if !px.is_finite() || px > MAX_PIXELS {
            return Err(format!("renderPage: {px:.0} pixels is more than this preview allows"));
        }
        let cache = self.session.cache.clone();
        let out = self
            .renderer
            .render_page(&doc, &cache, page, scale, bleed, &Default::default())
            .ok_or_else(|| format!("renderPage: there is no page {page}"))?;
        Ok(Rendered { width: out.width, height: out.height, rgba: out.to_straight() })
    }

    /// The print PDF as bytes. `opts` is `file.exportPdf`'s parameters without `path`.
    pub fn export_pdf(&mut self, opts: &str) -> Result<Vec<u8>, String> {
        let mut params: Value = if opts.trim().is_empty() {
            json!({})
        } else {
            serde_json::from_str(opts).map_err(|e| format!("exportPdf: options are not JSON: {e}"))?
        };
        let obj = params.as_object_mut().ok_or("exportPdf: options must be a JSON object")?;
        // The bridge never writes files: a path would be ignored in the browser and is refused
        // so the result is always the bytes.
        obj.remove("path");
        let r = self.session.execute("file.exportPdf", &params).map_err(|e| format!("exportPdf: {e}"))?;
        let b64 = r.get("base64").and_then(Value::as_str).ok_or("exportPdf: the engine returned no PDF")?;
        B64.decode(b64).map_err(|e| format!("exportPdf: {e}"))
    }

    /// The design in DesignCraft's native format, base64-encoded so it travels as a plain string
    /// (postMessage, storage) and Back or reopening keeps the work. The format is binary.
    pub fn save_design(&mut self) -> Result<String, String> {
        let r = self.session.execute("file.serialize", &json!({})).map_err(|e| format!("saveDesign: {e}"))?;
        r.get("base64").and_then(Value::as_str).map(str::to_string).ok_or_else(|| "saveDesign: the engine returned nothing".into())
    }

    /// Open a design saved by [`Bridge::save_design`] (base64) as the current document.
    pub fn open_design(&mut self, design: &str) -> Result<Value, String> {
        let design = design.trim();
        if design.is_empty() {
            return Err("openDesign: the design is empty".into());
        }
        B64.decode(design).map_err(|e| format!("openDesign: not a saved design: {e}"))?;
        let params = json!({"name": "design.designcraft", "base64": design});
        self.session.execute("file.openBytes", &params).map_err(|e| format!("openDesign: {e}"))
    }

    /// Open a design file (IDML, or a saved `.designcraft` design) as a new document, which
    /// becomes the current one. InDesign's own `.indd` is a closed binary format the engine
    /// cannot read; it is refused with [`INDD_UNSUPPORTED`] so the page can say how to export IDML.
    pub fn open_file(&mut self, bytes: &[u8], name: &str) -> Result<Value, String> {
        if bytes.is_empty() {
            return Err("openFile: the file is empty".into());
        }
        if bytes.len() > MAX_FILE_BYTES {
            return Err(format!("openFile: {} MB is larger than the {} MB allowed", bytes.len() / 1_048_576, MAX_FILE_BYTES / 1_048_576));
        }
        if is_indd(bytes, name) {
            return Err(INDD_UNSUPPORTED.into());
        }
        let name: String = name.chars().filter(|c| !c.is_control()).take(120).collect();
        let params = json!({"name": if name.is_empty() { "design.idml".to_string() } else { name }, "base64": B64.encode(bytes)});
        self.session.execute("file.openBytes", &params).map_err(|e| format!("openFile: {e}"))
    }

    /// Place image bytes (JPEG, PNG, …) into graphic frame `frame`. Encoding happens here rather
    /// than in JavaScript, where a phone photo would be copied through a giant string.
    pub fn place_image(&mut self, bytes: &[u8], name: &str, frame: u64) -> Result<Value, String> {
        if bytes.is_empty() {
            return Err("placeImage: the file is empty".into());
        }
        if bytes.len() > MAX_IMAGE_BYTES {
            return Err(format!("placeImage: {} MB is larger than the {} MB allowed", bytes.len() / 1_048_576, MAX_IMAGE_BYTES / 1_048_576));
        }
        let name: String = name.chars().filter(|c| !c.is_control()).take(120).collect();
        let params = json!({"base64": B64.encode(bytes), "name": if name.is_empty() { "image".to_string() } else { name }, "frame": frame});
        self.session.execute("file.place", &params).map_err(|e| format!("placeImage: {e}"))
    }
}

/// The JavaScript face of [`Bridge`]: `new Designer()`, then commands, renders and exports.
#[wasm_bindgen]
pub struct Designer {
    inner: Bridge,
}

/// A rendered page for canvas: `width`, `height` and straight RGBA bytes.
#[wasm_bindgen]
pub struct Page {
    width: u32,
    height: u32,
    rgba: Vec<u8>,
}

#[wasm_bindgen]
impl Page {
    #[wasm_bindgen(getter)]
    pub fn width(&self) -> u32 {
        self.width
    }
    #[wasm_bindgen(getter)]
    pub fn height(&self) -> u32 {
        self.height
    }
    /// The pixels, copied out once (use with `new ImageData(new Uint8ClampedArray(p.rgba), w, h)`).
    #[wasm_bindgen(getter)]
    pub fn rgba(&self) -> Vec<u8> {
        self.rgba.clone()
    }
}

fn js(e: String) -> JsError {
    JsError::new(&e)
}

#[wasm_bindgen]
impl Designer {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Designer {
        Designer { inner: Bridge::new() }
    }

    /// Run an engine command; returns its result as JSON text.
    pub fn execute(&mut self, command: &str, params_json: &str) -> Result<String, JsError> {
        self.inner.execute(command, params_json).map(|v| v.to_string()).map_err(js)
    }

    #[wasm_bindgen(js_name = renderPage)]
    pub fn render_page(&mut self, page: usize, scale: f64, bleed: bool) -> Result<Page, JsError> {
        let r = self.inner.render_page(page, scale, bleed).map_err(js)?;
        Ok(Page { width: r.width, height: r.height, rgba: r.rgba })
    }

    #[wasm_bindgen(js_name = exportPdf)]
    pub fn export_pdf(&mut self, opts_json: &str) -> Result<Vec<u8>, JsError> {
        self.inner.export_pdf(opts_json).map_err(js)
    }

    #[wasm_bindgen(js_name = saveDesign)]
    pub fn save_design(&mut self) -> Result<String, JsError> {
        self.inner.save_design().map_err(js)
    }

    #[wasm_bindgen(js_name = openDesign)]
    pub fn open_design(&mut self, design: &str) -> Result<String, JsError> {
        self.inner.open_design(design).map(|v| v.to_string()).map_err(js)
    }

    /// Open an IDML package or saved design; an InDesign `.indd` throws `indd-unsupported`.
    #[wasm_bindgen(js_name = openFile)]
    pub fn open_file(&mut self, bytes: &[u8], name: &str) -> Result<String, JsError> {
        self.inner.open_file(bytes, name).map(|v| v.to_string()).map_err(js)
    }

    #[wasm_bindgen(js_name = placeImage)]
    pub fn place_image(&mut self, bytes: &[u8], name: &str, frame: u32) -> Result<String, JsError> {
        self.inner.place_image(bytes, name, u64::from(frame)).map(|v| v.to_string()).map_err(js)
    }
}

impl Default for Designer {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn postcard() -> Bridge {
        let mut b = Bridge::new();
        b.execute("file.new", r#"{"width":648,"height":432,"pages":2,"facingPages":false,"bleed":9,"margins":9}"#).unwrap();
        b
    }

    #[test]
    fn renders_a_page_with_bleed_at_the_requested_scale() {
        let mut b = postcard();
        let r = b.render_page(0, 0.5, true).unwrap();
        assert_eq!((r.width, r.height), (333, 225), "(648 + 18) x (432 + 18) at 0.5 px/pt");
        assert_eq!(r.rgba.len(), 333 * 225 * 4);
        assert!(b.render_page(5, 0.5, true).is_err(), "no page 6");
    }

    #[test]
    fn refuses_hostile_input_instead_of_panicking() {
        let mut b = postcard();
        for s in [f64::NAN, f64::INFINITY, 0.0, -1.0, 1e9] {
            assert!(b.render_page(0, s, true).is_err(), "scale {s}");
        }
        assert!(b.execute("", "{}").is_err());
        assert!(b.execute("frame.create", "not json").is_err());
        assert!(b.execute("frame.create", "[1,2]").is_err());
        assert!(b.execute("no.such.command", "{}").is_err());
        assert!(b.place_image(&[], "x.png", 1).is_err());
        assert!(b.place_image(b"not an image", "x.png", 999_999).is_err());
        assert!(b.open_design("").is_err());
        assert!(b.open_design("{ not a design").is_err());
        assert!(b.export_pdf("[]").is_err());
        let mut empty = Bridge::new();
        assert!(empty.render_page(0, 1.0, false).is_err(), "no document yet");
        assert!(empty.export_pdf("{}").is_err(), "no document yet");
    }

    #[test]
    fn exports_pdf_bytes_and_ignores_a_path() {
        let mut b = postcard();
        b.execute("frame.create", r#"{"spread":0,"rect":[36,36,300,90],"content":"text","text":"Hello"}"#).unwrap();
        let pdf = b.export_pdf(r#"{"bleed":true,"standard":"x4","path":"/tmp/should-not-be-written.pdf"}"#).unwrap();
        assert!(pdf.starts_with(b"%PDF-"), "a PDF");
        assert!(!std::path::Path::new("/tmp/should-not-be-written.pdf").exists());
    }

    #[test]
    fn a_saved_design_reopens_with_its_content() {
        let mut b = postcard();
        b.execute("frame.create", r#"{"spread":1,"rect":[36,36,300,90],"content":"text","text":"Back side"}"#).unwrap();
        let saved = b.save_design().unwrap();
        let mut c = Bridge::new();
        c.open_design(&saved).unwrap();
        let ins = c.execute("document.inspect", "{}").unwrap();
        assert_eq!(ins["pageCount"], 2);
        assert!(ins["stories"].to_string().contains("Back side"));
    }

    #[test]
    fn opens_idml_and_refuses_indd_with_a_clear_code() {
        let mut b = postcard();
        b.execute("frame.create", r#"{"spread":0,"rect":[36,36,300,90],"content":"text","text":"From IDML"}"#).unwrap();
        // The engine writes IDML; open what it wrote, as a customer's file would arrive.
        let idml = B64.decode(b.execute("file.exportIdml", "{}").unwrap()["base64"].as_str().unwrap()).unwrap();
        let mut c = Bridge::new();
        c.open_file(&idml, "card.idml").unwrap();
        assert!(c.execute("document.inspect", "{}").unwrap()["stories"].to_string().contains("From IDML"));
        let mut indd = INDD_SIGNATURE.to_vec();
        indd.extend_from_slice(&[0; 64]);
        assert_eq!(b.open_file(&indd, "brochure.bin").unwrap_err(), INDD_UNSUPPORTED, "by signature");
        assert_eq!(b.open_file(b"anything", "Brochure.INDD").unwrap_err(), INDD_UNSUPPORTED, "by name");
        assert!(b.open_file(&[], "x.idml").is_err());
        assert!(b.open_file(b"not a zip", "x.idml").is_err());
    }

    #[test]
    fn places_an_image_into_a_frame() {
        let mut b = postcard();
        let f = b.execute("frame.create", r#"{"spread":0,"rect":[0,0,200,100],"content":"graphic"}"#).unwrap();
        let id = f["id"].as_u64().unwrap();
        // A 2 x 1 PNG.
        let png = B64.decode("iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAIAAAB7QOjdAAAAEElEQVR4nGP4z8DAwMDAAAAP/wH/YrJcGQAAAABJRU5ErkJggg==").unwrap();
        let r = b.place_image(&png, "dot.png", id).unwrap();
        assert!(r.get("asset").is_some(), "{r}");
    }
}
