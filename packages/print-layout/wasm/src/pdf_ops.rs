use std::collections::{BTreeMap, HashMap, HashSet};
use std::fmt::Write as _;
use std::io::{Read as _, Write as _};

use flate2::Compression;
use flate2::read::ZlibDecoder;
use flate2::write::ZlibEncoder;
use lopdf::xref::{XrefEntry, XrefType};
use lopdf::{Dictionary, Document, Object, ObjectId, Stream};
use serde::{Deserialize, Serialize};

use crate::gray_pdf::format_pdf_num;
use crate::pixels::decode_png_rgb_alpha;

const CUT_MARK_WIDTH_PT: f64 = 0.5;
const CELL_BORDER_WIDTH_PT: f64 = 0.5;
const TILE_LABEL_FONT_PT: f64 = 8.0;

#[derive(Debug, Clone, Copy)]
struct PdfBox {
    left: f64,
    bottom: f64,
    right: f64,
    top: f64,
}

#[derive(Debug, Clone, Serialize)]
pub struct PageSizeDto {
    #[serde(rename = "widthPt")]
    pub width_pt: f64,
    #[serde(rename = "heightPt")]
    pub height_pt: f64,
}

#[derive(Debug, Deserialize)]
pub struct RectDto {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Debug, Deserialize)]
pub struct LineSegmentDto {
    pub x1: f64,
    pub y1: f64,
    pub x2: f64,
    pub y2: f64,
}

#[derive(Debug, Deserialize)]
pub struct PlacedCellDto {
    #[serde(rename = "box")]
    pub box_rect: RectDto,
    #[serde(rename = "pageIndex")]
    pub page_index: Option<usize>,
    pub content: Option<RectDto>,
}

#[derive(Debug, Deserialize)]
pub struct PlannedFaceDto {
    pub width: f64,
    pub height: f64,
    pub cells: Vec<PlacedCellDto>,
    #[serde(rename = "cutMarks")]
    pub cut_marks: Vec<LineSegmentDto>,
    #[serde(default, rename = "cellBorders")]
    pub cell_borders: Vec<RectDto>,
    #[serde(default, rename = "tileLabel")]
    pub tile_label: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct OverlayPlacementDto {
    #[serde(rename = "stampIndex")]
    pub stamp_index: usize,
    pub x: Option<f64>,
    pub y: Option<f64>,
    pub width: Option<f64>,
    pub height: Option<f64>,
    pub opacity: Option<f64>,
}

#[derive(Debug, Clone)]
struct SourcePageInfo {
    page_id: ObjectId,
    vis_box: PdfBox,
    rotate: i32,
    size: PageSizeDto,
    empty: bool,
}

fn normalize_rotation(angle: f64) -> i32 {
    let quarter = (angle / 90.0).round() as i64;
    ((((quarter % 4) + 4) % 4) * 90) as i32
}

fn load_unencrypted(pdf_bytes: &[u8]) -> Result<Document, String> {
    let doc = Document::load_mem(pdf_bytes).map_err(|e| format!("failed to parse PDF: {e}"))?;
    if doc.is_encrypted() {
        return Err("encrypted PDF is not supported".to_string());
    }
    Ok(doc)
}

fn resolve_object<'a>(doc: &'a Document, mut obj: &'a Object) -> Option<&'a Object> {
    for _ in 0..32 {
        match obj {
            Object::Reference(id) => {
                obj = doc.objects.get(id)?;
            }
            _ => return Some(obj),
        }
    }
    None
}

fn resolve_dict<'a>(doc: &'a Document, id: ObjectId) -> Option<&'a Dictionary> {
    match doc.objects.get(&id)? {
        Object::Dictionary(d) => Some(d),
        _ => None,
    }
}

/// Walks a page dictionary and its `/Parent` chain to resolve inheritable page
/// attributes (`/MediaBox`, `/CropBox`, `/Rotate`, `/Resources`).
fn resolve_inherited<'a>(
    doc: &'a Document,
    start_id: ObjectId,
    key: &[u8],
) -> Option<&'a Object> {
    let mut cur = start_id;
    let mut visited = HashSet::new();
    while visited.insert(cur) {
        let dict = resolve_dict(doc, cur)?;
        if let Ok(val) = dict.get(key) {
            return Some(val);
        }
        match dict.get(b"Parent").ok() {
            Some(Object::Reference(parent_id)) => cur = *parent_id,
            _ => return None,
        }
    }
    None
}

fn as_f64(doc: &Document, obj: &Object) -> Option<f64> {
    match resolve_object(doc, obj)? {
        Object::Integer(i) => Some(*i as f64),
        Object::Real(f) => Some(*f as f64),
        _ => None,
    }
}

fn parse_box(doc: &Document, obj: &Object) -> Option<PdfBox> {
    let arr = match resolve_object(doc, obj)? {
        Object::Array(a) if a.len() >= 4 => a,
        _ => return None,
    };
    let x1 = as_f64(doc, &arr[0])?;
    let y1 = as_f64(doc, &arr[1])?;
    let x2 = as_f64(doc, &arr[2])?;
    let y2 = as_f64(doc, &arr[3])?;
    Some(PdfBox {
        left: x1.min(x2),
        bottom: y1.min(y2),
        right: x1.max(x2),
        top: y1.max(y2),
    })
}

fn is_page_empty(doc: &Document, page_id: ObjectId) -> bool {
    let Some(dict) = resolve_dict(doc, page_id) else {
        return true;
    };
    let Ok(contents) = dict.get(b"Contents") else {
        return true;
    };
    match resolve_object(doc, contents) {
        None | Some(Object::Null) => true,
        Some(Object::Array(arr)) => arr.is_empty(),
        Some(Object::Stream(_)) => false,
        _ => true,
    }
}

fn collect_page_infos(doc: &Document) -> Result<Vec<SourcePageInfo>, String> {
    let pages: BTreeMap<u32, ObjectId> = doc.get_pages();
    let mut infos = Vec::with_capacity(pages.len());
    for (_page_num, page_id) in pages {
        let media = resolve_inherited(doc, page_id, b"MediaBox")
            .and_then(|o| parse_box(doc, o))
            .ok_or_else(|| "page is missing /MediaBox".to_string())?;
        let crop = resolve_inherited(doc, page_id, b"CropBox")
            .and_then(|o| parse_box(doc, o))
            .unwrap_or(media);
        let left = media.left.max(crop.left);
        let bottom = media.bottom.max(crop.bottom);
        let right = media.right.min(crop.right);
        let top = media.top.min(crop.top);
        let vis_box = if right > left && top > bottom {
            PdfBox {
                left,
                bottom,
                right,
                top,
            }
        } else {
            media
        };
        let rotate = resolve_inherited(doc, page_id, b"Rotate")
            .and_then(|o| as_f64(doc, o))
            .map(normalize_rotation)
            .unwrap_or(0);
        let w = vis_box.right - vis_box.left;
        let h = vis_box.top - vis_box.bottom;
        let size = if rotate % 180 == 0 {
            PageSizeDto {
                width_pt: w,
                height_pt: h,
            }
        } else {
            PageSizeDto {
                width_pt: h,
                height_pt: w,
            }
        };
        let empty = is_page_empty(doc, page_id);
        infos.push(SourcePageInfo {
            page_id,
            vis_box,
            rotate,
            size,
            empty,
        });
    }
    Ok(infos)
}

/// Reads each page's displayed size in points (`/Rotate` and `CropBox ∩ MediaBox` applied).
pub fn read_job_page_sizes(pdf_bytes: &[u8]) -> Result<Vec<PageSizeDto>, String> {
    let doc = load_unencrypted(pdf_bytes)?;
    let infos = collect_page_infos(&doc)?;
    Ok(infos.into_iter().map(|i| i.size).collect())
}

/// Deep-copies a PDF object graph from `src` into `out`, deduplicating all
/// shared indirect objects across the entire document through `remap`.
fn copy_object(
    src: &Document,
    out: &mut Document,
    remap: &mut HashMap<ObjectId, ObjectId>,
    obj: &Object,
) -> Object {
    match obj {
        Object::Reference(src_id) => {
            if let Some(&mapped) = remap.get(src_id) {
                return Object::Reference(mapped);
            }
            let new_id = out.new_object_id();
            // Insert before recursing to guard against cyclic references.
            remap.insert(*src_id, new_id);
            let cloned = match src.objects.get(src_id) {
                Some(target) => copy_object(src, out, remap, target),
                None => Object::Null,
            };
            out.objects.insert(new_id, cloned);
            Object::Reference(new_id)
        }
        Object::Array(items) => Object::Array(
            items
                .iter()
                .map(|item| copy_object(src, out, remap, item))
                .collect(),
        ),
        Object::Dictionary(dict) => {
            let mut new_dict = Dictionary::new();
            for (k, v) in dict.iter() {
                new_dict.set(k.clone(), copy_object(src, out, remap, v));
            }
            Object::Dictionary(new_dict)
        }
        Object::Stream(stream) => {
            let mut new_dict = Dictionary::new();
            for (k, v) in stream.dict.iter() {
                new_dict.set(k.clone(), copy_object(src, out, remap, v));
            }
            new_dict.set("Length", Object::Integer(stream.content.len() as i64));
            Object::Stream(Stream::new(new_dict, stream.content.clone()))
        }
        other => other.clone(),
    }
}

fn collect_content_streams<'a>(src: &'a Document, page_id: ObjectId) -> Vec<&'a Stream> {
    let Some(dict) = resolve_dict(src, page_id) else {
        return Vec::new();
    };
    let Ok(contents) = dict.get(b"Contents") else {
        return Vec::new();
    };
    match resolve_object(src, contents) {
        Some(Object::Stream(s)) => vec![s],
        Some(Object::Array(arr)) => {
            let mut out = Vec::with_capacity(arr.len());
            for item in arr {
                if let Some(Object::Stream(s)) = resolve_object(src, item) {
                    out.push(s);
                }
            }
            out
        }
        _ => Vec::new(),
    }
}

/// Embeds a source page into `out` as a Form XObject (`/Type /XObject`,
/// `/Subtype /Form`), keeping text as text and sharing all referenced resources
/// across pages through `remap`. Single-stream pages are copied verbatim without
/// decompression/recompression.
fn zlib_compress_fast(data: &[u8]) -> Result<Vec<u8>, String> {
    let mut enc = ZlibEncoder::new(Vec::with_capacity(data.len() / 2), Compression::fast());
    enc.write_all(data)
        .map_err(|e| format!("stream compression failed: {e}"))?;
    enc.finish()
        .map_err(|e| format!("stream compression finish failed: {e}"))
}

fn embed_page_as_form(
    src: &Document,
    out: &mut Document,
    remap: &mut HashMap<ObjectId, ObjectId>,
    info: &SourcePageInfo,
) -> Result<ObjectId, String> {
    let streams = collect_content_streams(src, info.page_id);
    if streams.is_empty() {
        return Err("cannot embed page without content streams".to_string());
    }

    let resources_obj = match resolve_inherited(src, info.page_id, b"Resources") {
        Some(res) => copy_object(src, out, remap, res),
        None => Object::Dictionary(Dictionary::new()),
    };

    let b = info.vis_box;
    let mut form_dict = Dictionary::new();
    form_dict.set("Type", Object::Name(b"XObject".to_vec()));
    form_dict.set("Subtype", Object::Name(b"Form".to_vec()));
    form_dict.set("FormType", Object::Integer(1));
    form_dict.set(
        "BBox",
        Object::Array(vec![
            Object::Real(b.left as f32),
            Object::Real(b.bottom as f32),
            Object::Real(b.right as f32),
            Object::Real(b.top as f32),
        ]),
    );
    form_dict.set(
        "Matrix",
        Object::Array(vec![
            Object::Integer(1),
            Object::Integer(0),
            Object::Integer(0),
            Object::Integer(1),
            Object::Real(-b.left as f32),
            Object::Real(-b.bottom as f32),
        ]),
    );
    form_dict.set("Resources", resources_obj);

    let content_bytes = if streams.len() == 1 {
        let s = streams[0];
        if let Ok(filter) = s.dict.get(b"Filter") {
            form_dict.set("Filter", copy_object(src, out, remap, filter));
        }
        if let Ok(parms) = s.dict.get(b"DecodeParms") {
            form_dict.set("DecodeParms", copy_object(src, out, remap, parms));
        }
        s.content.clone()
    } else {
        let mut combined = Vec::new();
        for s in streams {
            let decoded = s
                .decompressed_content()
                .map_err(|e| format!("failed to decode page content stream: {e}"))?;
            combined.extend_from_slice(&decoded);
            combined.push(b'\n');
        }
        let compressed = zlib_compress_fast(&combined)?;
        form_dict.set("Filter", Object::Name(b"FlateDecode".to_vec()));
        compressed
    };

    form_dict.set("Length", Object::Integer(content_bytes.len() as i64));
    let form_id = out.add_object(Object::Stream(Stream::new(form_dict, content_bytes)));
    Ok(form_id)
}

/// Builds the arranged PDF according to the precomputed sheet plan faces.
/// Source pages remain Form XObjects (text stays text), each cell is clipped to
/// its box, `/Rotate` and `CropBox ∩ MediaBox` are honoured, and cut marks are
/// drawn as 0.5pt black lines.
pub fn arrange_pdf(pdf_bytes: &[u8], faces: &[PlannedFaceDto]) -> Result<Vec<u8>, String> {
    if faces.is_empty() {
        return Err("no-faces: the sheet plan has no faces".to_string());
    }
    let src = load_unencrypted(pdf_bytes)?;
    let infos = collect_page_infos(&src)?;

    let version = if src.version.as_str() >= "1.4" && src.version.as_str() <= "1.7" {
        src.version.clone()
    } else {
        "1.7".to_string()
    };
    let mut out = Document::with_version(version);
    let pages_id = out.new_object_id();

    let mut remap: HashMap<ObjectId, ObjectId> = HashMap::new();
    let mut embedded: HashMap<usize, ObjectId> = HashMap::new();
    let mut page_refs: Vec<Object> = Vec::with_capacity(faces.len());

    for face in faces {
        let mut xobjects = Dictionary::new();
        let mut content = String::new();

        for cell in &face.cells {
            let (Some(page_index), Some(cell_content)) = (cell.page_index, &cell.content) else {
                continue;
            };
            let info = infos
                .get(page_index)
                .ok_or_else(|| format!("page index {page_index} out of range"))?;
            if info.empty {
                continue;
            }

            let form_id = match embedded.get(&page_index) {
                Some(&id) => id,
                None => {
                    let id = embed_page_as_form(&src, &mut out, &mut remap, info)?;
                    embedded.insert(page_index, id);
                    id
                }
            };
            let xobj_name = format!("P{page_index}");
            xobjects.set(xobj_name.as_bytes(), Object::Reference(form_id));

            // Clip box in PDF bottom-left coordinates.
            let clip_x = cell.box_rect.x;
            let clip_y = face.height - cell.box_rect.y - cell.box_rect.height;
            let clip_w = cell.box_rect.width;
            let clip_h = cell.box_rect.height;

            // Target content box in PDF bottom-left coordinates.
            let target_x = cell_content.x;
            let target_y = face.height - cell_content.y - cell_content.height;
            let s = cell_content.width / info.size.width_pt;
            let w = info.vis_box.right - info.vis_box.left;
            let h = info.vis_box.top - info.vis_box.bottom;

            let (a, b, c, d, e, f) = match info.rotate {
                90 => (0.0, -s, s, 0.0, target_x, target_y + s * w),
                180 => (-s, 0.0, 0.0, -s, target_x + s * w, target_y + s * h),
                270 => (0.0, s, -s, 0.0, target_x + s * h, target_y),
                _ => (s, 0.0, 0.0, s, target_x, target_y),
            };

            let _ = writeln!(
                &mut content,
                "q\n{} {} {} {} re W n\n{} {} {} {} {} {} cm\n/{xobj_name} Do\nQ",
                format_pdf_num(clip_x),
                format_pdf_num(clip_y),
                format_pdf_num(clip_w),
                format_pdf_num(clip_h),
                format_pdf_num(a),
                format_pdf_num(b),
                format_pdf_num(c),
                format_pdf_num(d),
                format_pdf_num(e),
                format_pdf_num(f),
            );
        }

        for m in &face.cut_marks {
            let _ = writeln!(
                &mut content,
                "q\n0 0 0 RG\n{} w\n{} {} m {} {} l S\nQ",
                format_pdf_num(CUT_MARK_WIDTH_PT),
                format_pdf_num(m.x1),
                format_pdf_num(face.height - m.y1),
                format_pdf_num(m.x2),
                format_pdf_num(face.height - m.y2),
            );
        }

        for b in &face.cell_borders {
            let _ = writeln!(
                &mut content,
                "q\n0.5 0.5 0.5 RG\n{} w\n{} {} {} {} re S\nQ",
                format_pdf_num(CELL_BORDER_WIDTH_PT),
                format_pdf_num(b.x),
                format_pdf_num(face.height - b.y - b.height),
                format_pdf_num(b.width),
                format_pdf_num(b.height),
            );
        }

        let mut fonts = Dictionary::new();
        if let Some(ref label) = face.tile_label {
            if !label.is_empty() {
                let mut escaped = String::with_capacity(label.len());
                for ch in label.chars() {
                    if ch.is_ascii() && !ch.is_ascii_control() {
                        if matches!(ch, '(' | ')' | '\\') {
                            escaped.push('\\');
                        }
                        escaped.push(ch);
                    }
                }
                if !escaped.is_empty() {
                    let font_dict = Dictionary::from_iter(vec![
                        ("Type", Object::Name(b"Font".to_vec())),
                        ("Subtype", Object::Name(b"Type1".to_vec())),
                        ("BaseFont", Object::Name(b"Helvetica".to_vec())),
                    ]);
                    fonts.set("F0", Object::Dictionary(font_dict));
                    let pad_x = 3.0;
                    let pad_y = 2.0;
                    let pill_w = (escaped.len() as f64) * 4.8 + pad_x * 2.0;
                    let pill_h = TILE_LABEL_FONT_PT + pad_y * 2.0;
                    let pill_x = 6.0;
                    let pill_y = (face.height - 6.0 - pill_h).max(0.0);
                    let text_x = pill_x + pad_x;
                    let text_y = pill_y + pad_y + 1.5;
                    let _ = writeln!(
                        &mut content,
                        "q\n1 1 1 rg\n{} {} {} {} re f\n0.2 0.2 0.2 rg\nBT\n/F0 {} Tf\n{} {} Td\n({}) Tj\nET\nQ",
                        format_pdf_num(pill_x),
                        format_pdf_num(pill_y),
                        format_pdf_num(pill_w),
                        format_pdf_num(pill_h),
                        format_pdf_num(TILE_LABEL_FONT_PT),
                        format_pdf_num(text_x),
                        format_pdf_num(text_y),
                        escaped,
                    );
                }
            }
        }

        let content_bytes = content.into_bytes();
        let mut content_dict = Dictionary::new();
        let stream_data = if content_bytes.len() > 256 {
            content_dict.set("Filter", Object::Name(b"FlateDecode".to_vec()));
            zlib_compress_fast(&content_bytes)?
        } else {
            content_bytes
        };
        content_dict.set("Length", Object::Integer(stream_data.len() as i64));
        let content_id = out.add_object(Object::Stream(Stream::new(content_dict, stream_data)));

        let mut resources = Dictionary::new();
        if !xobjects.is_empty() {
            resources.set("XObject", Object::Dictionary(xobjects));
        }
        if !fonts.is_empty() {
            resources.set("Font", Object::Dictionary(fonts));
        }

        let mut page_dict = Dictionary::new();
        page_dict.set("Type", Object::Name(b"Page".to_vec()));
        page_dict.set("Parent", Object::Reference(pages_id));
        page_dict.set(
            "MediaBox",
            Object::Array(vec![
                Object::Integer(0),
                Object::Integer(0),
                Object::Real(face.width as f32),
                Object::Real(face.height as f32),
            ]),
        );
        page_dict.set("Resources", Object::Dictionary(resources));
        page_dict.set("Contents", Object::Reference(content_id));
        let page_id = out.add_object(Object::Dictionary(page_dict));
        page_refs.push(Object::Reference(page_id));
    }

    let mut pages_dict = Dictionary::new();
    pages_dict.set("Type", Object::Name(b"Pages".to_vec()));
    pages_dict.set("Count", Object::Integer(page_refs.len() as i64));
    pages_dict.set("Kids", Object::Array(page_refs));
    out.objects.insert(pages_id, Object::Dictionary(pages_dict));

    let mut catalog = Dictionary::new();
    catalog.set("Type", Object::Name(b"Catalog".to_vec()));
    catalog.set("Pages", Object::Reference(pages_id));
    let catalog_id = out.add_object(Object::Dictionary(catalog));
    out.trailer.set("Root", Object::Reference(catalog_id));

    let mut saved = Vec::new();
    out.save_to(&mut saved)
        .map_err(|e| format!("failed to serialize arranged PDF: {e}"))?;
    Ok(saved)
}

fn is_pdf_ws(b: u8) -> bool {
    matches!(b, b' ' | b'\t' | b'\r' | b'\n' | 0x00 | 0x0c)
}

fn is_pdf_delim(b: u8) -> bool {
    is_pdf_ws(b)
        || matches!(
            b,
            b'(' | b')' | b'<' | b'>' | b'[' | b']' | b'{' | b'}' | b'/' | b'%'
        )
}

fn skip_ws_and_comments(data: &[u8], mut i: usize) -> usize {
    while i < data.len() {
        if is_pdf_ws(data[i]) {
            i += 1;
        } else if data[i] == b'%' {
            while i < data.len() && data[i] != b'\n' && data[i] != b'\r' {
                i += 1;
            }
        } else {
            break;
        }
    }
    i
}

/// Skips a PDF literal string `(...)`, hex string `<...>`, or returns `i + 1`.
fn skip_literal_string(data: &[u8], mut i: usize) -> usize {
    // Assumes data[i] == b'('
    i += 1;
    let mut depth = 1usize;
    while i < data.len() && depth > 0 {
        match data[i] {
            b'\\' => i = (i + 2).min(data.len()),
            b'(' => {
                depth += 1;
                i += 1;
            }
            b')' => {
                depth -= 1;
                i += 1;
            }
            _ => i += 1,
        }
    }
    i
}

/// Extracts the balanced `<< ... >>` dictionary starting at or after `start`.
fn extract_raw_dict(data: &[u8], start: usize) -> Option<(usize, usize)> {
    let i0 = skip_ws_and_comments(data, start);
    if i0 + 1 >= data.len() || data[i0] != b'<' || data[i0 + 1] != b'<' {
        return None;
    }
    let mut i = i0 + 2;
    let mut depth = 1usize;
    while i < data.len() && depth > 0 {
        match data[i] {
            b'%' => {
                while i < data.len() && data[i] != b'\n' && data[i] != b'\r' {
                    i += 1;
                }
            }
            b'(' => i = skip_literal_string(data, i),
            b'<' if i + 1 < data.len() && data[i + 1] == b'<' => {
                depth += 1;
                i += 2;
            }
            b'>' if i + 1 < data.len() && data[i + 1] == b'>' => {
                depth -= 1;
                i += 2;
            }
            _ => i += 1,
        }
    }
    if depth == 0 { Some((i0, i)) } else { None }
}

/// Finds the last `startxref` offset in the tail of a PDF.
fn find_startxref(pdf_bytes: &[u8]) -> Option<usize> {
    let tail_start = pdf_bytes.len().saturating_sub(2048);
    let tail = &pdf_bytes[tail_start..];
    let needle = b"startxref";
    let pos = tail.windows(needle.len()).rposition(|w| w == needle)?;
    let mut i = skip_ws_and_comments(tail, pos + needle.len());
    let num_start = i;
    while i < tail.len() && tail[i].is_ascii_digit() {
        i += 1;
    }
    if i == num_start {
        return None;
    }
    std::str::from_utf8(&tail[num_start..i]).ok()?.parse().ok()
}

/// Skips `<num> <gen> obj` at `offset` and returns the byte index after `obj`.
fn skip_obj_header(data: &[u8], offset: usize) -> Option<usize> {
    let mut i = skip_ws_and_comments(data, offset);
    // obj num
    let n0 = i;
    while i < data.len() && data[i].is_ascii_digit() {
        i += 1;
    }
    if i == n0 {
        return None;
    }
    i = skip_ws_and_comments(data, i);
    // gen num
    let g0 = i;
    while i < data.len() && data[i].is_ascii_digit() {
        i += 1;
    }
    if i == g0 {
        return None;
    }
    i = skip_ws_and_comments(data, i);
    if i + 3 <= data.len() && &data[i..i + 3] == b"obj" {
        Some(i + 3)
    } else {
        None
    }
}

/// Parses a direct or indirect integer value for `/Key` inside a raw dict slice.
fn read_dict_int_key(raw_dict: &[u8], doc: &Document, key: &[u8]) -> Option<usize> {
    let mut i = 2usize; // after "<<"
    let end = raw_dict.len().saturating_sub(2);
    let mut depth = 0usize;
    let mut arr_depth = 0usize;
    while i < end {
        i = skip_ws_and_comments(raw_dict, i);
        if i >= end {
            break;
        }
        match raw_dict[i] {
            b'(' => i = skip_literal_string(raw_dict, i),
            b'<' if i + 1 < end && raw_dict[i + 1] == b'<' => {
                depth += 1;
                i += 2;
            }
            b'>' if i + 1 < end && raw_dict[i + 1] == b'>' => {
                depth = depth.saturating_sub(1);
                i += 2;
            }
            b'[' => {
                arr_depth += 1;
                i += 1;
            }
            b']' => {
                arr_depth = arr_depth.saturating_sub(1);
                i += 1;
            }
            b'/' if depth == 0 && arr_depth == 0 => {
                let k0 = i + 1;
                i = k0;
                while i < end && !is_pdf_delim(raw_dict[i]) {
                    i += 1;
                }
                if &raw_dict[k0..i] == key {
                    let v0 = skip_ws_and_comments(raw_dict, i);
                    let mut v1 = v0;
                    while v1 < end && raw_dict[v1].is_ascii_digit() {
                        v1 += 1;
                    }
                    if v1 == v0 {
                        return None;
                    }
                    let first_num: u32 = std::str::from_utf8(&raw_dict[v0..v1]).ok()?.parse().ok()?;
                    let g0 = skip_ws_and_comments(raw_dict, v1);
                    let mut g1 = g0;
                    while g1 < end && raw_dict[g1].is_ascii_digit() {
                        g1 += 1;
                    }
                    if g1 > g0 {
                        let r0 = skip_ws_and_comments(raw_dict, g1);
                        if r0 < end
                            && raw_dict[r0] == b'R'
                            && (r0 + 1 >= end || is_pdf_delim(raw_dict[r0 + 1]))
                        {
                            let obj_gen: u16 =
                                std::str::from_utf8(&raw_dict[g0..g1]).ok()?.parse().ok()?;
                            return match doc.objects.get(&(first_num, obj_gen)) {
                                Some(Object::Integer(n)) if *n >= 0 => Some(*n as usize),
                                _ => None,
                            };
                        }
                    }
                    return Some(first_num as usize);
                }
            }
            _ => i += 1,
        }
    }
    None
}

/// Checks if a raw `/ObjStm` dict uses no filter (None) or `/FlateDecode` (Some(true)).
/// Returns `Some(false)` for no filter, `Some(true)` for FlateDecode, `None` for others.
fn objstm_is_flate(raw_dict: &[u8]) -> Option<bool> {
    let mut i = 2usize;
    let end = raw_dict.len().saturating_sub(2);
    let mut depth = 0usize;
    let mut arr_depth = 0usize;
    while i < end {
        i = skip_ws_and_comments(raw_dict, i);
        if i >= end {
            break;
        }
        match raw_dict[i] {
            b'(' => i = skip_literal_string(raw_dict, i),
            b'<' if i + 1 < end && raw_dict[i + 1] == b'<' => {
                depth += 1;
                i += 2;
            }
            b'>' if i + 1 < end && raw_dict[i + 1] == b'>' => {
                depth = depth.saturating_sub(1);
                i += 2;
            }
            b'[' => {
                arr_depth += 1;
                i += 1;
            }
            b']' => {
                arr_depth = arr_depth.saturating_sub(1);
                i += 1;
            }
            b'/' if depth == 0 && arr_depth == 0 => {
                let k0 = i + 1;
                i = k0;
                while i < end && !is_pdf_delim(raw_dict[i]) {
                    i += 1;
                }
                if &raw_dict[k0..i] == b"Filter" {
                    let v0 = skip_ws_and_comments(raw_dict, i);
                    if v0 < end && raw_dict[v0] == b'/' {
                        let mut v1 = v0 + 1;
                        while v1 < end && !is_pdf_delim(raw_dict[v1]) {
                            v1 += 1;
                        }
                        return if &raw_dict[v0 + 1..v1] == b"FlateDecode" {
                            Some(true)
                        } else {
                            None
                        };
                    }
                    return None;
                }
                if &raw_dict[k0..i] == b"DecodeParms" {
                    return None;
                }
            }
            _ => i += 1,
        }
    }
    Some(false)
}

struct UnpackedObjStm {
    first: usize,
    offsets: HashMap<u32, usize>,
    data: Vec<u8>,
}

fn unpack_objstm(pdf_bytes: &[u8], doc: &Document, container: u32) -> Option<UnpackedObjStm> {
    let offset = match doc.reference_table.get(container)? {
        XrefEntry::Normal { offset, .. } => *offset as usize,
        _ => return None,
    };
    let after_obj = skip_obj_header(pdf_bytes, offset)?;
    let (d0, d1) = extract_raw_dict(pdf_bytes, after_obj)?;
    let raw_dict = &pdf_bytes[d0..d1];
    let length = read_dict_int_key(raw_dict, doc, b"Length")?;
    let first = read_dict_int_key(raw_dict, doc, b"First")?;
    let count = read_dict_int_key(raw_dict, doc, b"N")?;
    let flate = objstm_is_flate(raw_dict)?;

    let s_kw = skip_ws_and_comments(pdf_bytes, d1);
    if s_kw + 6 > pdf_bytes.len() || &pdf_bytes[s_kw..s_kw + 6] != b"stream" {
        return None;
    }
    let mut s_start = s_kw + 6;
    if s_start + 1 < pdf_bytes.len() && pdf_bytes[s_start] == b'\r' && pdf_bytes[s_start + 1] == b'\n' {
        s_start += 2;
    } else if s_start < pdf_bytes.len() && pdf_bytes[s_start] == b'\n' {
        s_start += 1;
    } else {
        return None;
    }
    let s_end = s_start.checked_add(length)?;
    if s_end > pdf_bytes.len() {
        return None;
    }
    let raw_stream = &pdf_bytes[s_start..s_end];
    let data = if flate {
        let mut dec = ZlibDecoder::new(raw_stream);
        let mut out = Vec::new();
        dec.read_to_end(&mut out).ok()?;
        out
    } else {
        raw_stream.to_vec()
    };
    if first > data.len() {
        return None;
    }
    let header_str = std::str::from_utf8(&data[..first]).ok()?;
    let mut nums = header_str.split_whitespace();
    let mut offsets = HashMap::with_capacity(count);
    for _ in 0..count {
        let obj_num: u32 = nums.next()?.parse().ok()?;
        let rel: usize = nums.next()?.parse().ok()?;
        offsets.insert(obj_num, rel);
    }
    Some(UnpackedObjStm {
        first,
        offsets,
        data,
    })
}

/// Skips one PDF value token starting at `start` (number, indirect ref `N G R`,
/// name, string, array, dict, bool, null) and returns the byte index after it.
fn skip_pdf_value(data: &[u8], start: usize, limit: usize) -> usize {
    let i = skip_ws_and_comments(data, start);
    if i >= limit {
        return limit;
    }
    match data[i] {
        b'(' => skip_literal_string(data, i).min(limit),
        b'<' if i + 1 < limit && data[i + 1] == b'<' => {
            extract_raw_dict(&data[..limit], i).map(|(_, e)| e).unwrap_or(limit)
        }
        b'<' => {
            let mut j = i + 1;
            while j < limit && data[j] != b'>' {
                j += 1;
            }
            (j + 1).min(limit)
        }
        b'[' => {
            let mut j = i + 1;
            let mut depth = 1usize;
            while j < limit && depth > 0 {
                match data[j] {
                    b'(' => j = skip_literal_string(data, j),
                    b'[' => {
                        depth += 1;
                        j += 1;
                    }
                    b']' => {
                        depth -= 1;
                        j += 1;
                    }
                    _ => j += 1,
                }
            }
            j.min(limit)
        }
        b'/' => {
            let mut j = i + 1;
            while j < limit && !is_pdf_delim(data[j]) {
                j += 1;
            }
            j
        }
        _ => {
            let mut j = i;
            while j < limit && !is_pdf_delim(data[j]) {
                j += 1;
            }
            // Check for indirect reference `<num> <gen> R`.
            let t1 = &data[i..j];
            if !t1.is_empty() && t1.iter().all(|b| b.is_ascii_digit()) {
                let g0 = skip_ws_and_comments(data, j);
                let mut g1 = g0;
                while g1 < limit && data[g1].is_ascii_digit() {
                    g1 += 1;
                }
                if g1 > g0 {
                    let r0 = skip_ws_and_comments(data, g1);
                    if r0 < limit
                        && data[r0] == b'R'
                        && (r0 + 1 >= limit || is_pdf_delim(data[r0 + 1]))
                    {
                        return r0 + 1;
                    }
                }
            }
            j
        }
    }
}

/// Replaces or inserts `/Rotate <new_angle>` in a raw `<< ... >>` page
/// dictionary without touching `/MediaBox` or any other entry.
fn patch_rotate_in_raw_dict(raw_dict: &[u8], new_angle: i32) -> Option<Vec<u8>> {
    if raw_dict.len() < 4 || !raw_dict.starts_with(b"<<") || !raw_dict.ends_with(b">>") {
        return None;
    }
    let limit = raw_dict.len() - 2;
    let mut i = 2usize;
    let mut val_span: Option<(usize, usize)> = None;

    while i < limit {
        i = skip_ws_and_comments(raw_dict, i);
        if i >= limit {
            break;
        }
        if raw_dict[i] != b'/' {
            return None;
        }
        let k0 = i + 1;
        let mut k1 = k0;
        while k1 < limit && !is_pdf_delim(raw_dict[k1]) {
            k1 += 1;
        }
        let v0 = skip_ws_and_comments(raw_dict, k1);
        let v1 = skip_pdf_value(raw_dict, v0, limit);
        if &raw_dict[k0..k1] == b"Rotate" {
            val_span = Some((v0, v1));
            break;
        }
        i = v1;
    }

    let angle_str = new_angle.to_string();
    let mut out = Vec::with_capacity(raw_dict.len() + 16);
    if let Some((v0, v1)) = val_span {
        out.extend_from_slice(&raw_dict[..v0]);
        out.extend_from_slice(angle_str.as_bytes());
        out.extend_from_slice(&raw_dict[v1..]);
    } else {
        out.extend_from_slice(&raw_dict[..limit]);
        out.extend_from_slice(b" /Rotate ");
        out.extend_from_slice(angle_str.as_bytes());
        out.extend_from_slice(b">>");
    }
    Some(out)
}

fn try_incremental_rotate(
    pdf_bytes: &[u8],
    doc: &Document,
    updates: &[(ObjectId, i32)],
) -> Option<Vec<u8>> {
    if doc.xref_recovery.is_some() {
        return None;
    }
    let prev_xref = find_startxref(pdf_bytes)?;
    let root_id = match doc.trailer.get(b"Root").ok()? {
        Object::Reference(id) => *id,
        _ => return None,
    };

    let mut objstm_cache: HashMap<u32, UnpackedObjStm> = HashMap::new();
    let mut patched: Vec<(u32, u16, Vec<u8>)> = Vec::with_capacity(updates.len());

    for &(page_id, new_angle) in updates {
        let entry = doc.reference_table.get(page_id.0)?.clone();
        let (obj_gen, raw_dict) = match entry {
            XrefEntry::Normal { offset, generation } => {
                let after = skip_obj_header(pdf_bytes, offset as usize)?;
                let (d0, d1) = extract_raw_dict(pdf_bytes, after)?;
                (generation, pdf_bytes[d0..d1].to_vec())
            }
            XrefEntry::Compressed { container, .. } => {
                if !objstm_cache.contains_key(&container) {
                    let unpacked = unpack_objstm(pdf_bytes, doc, container)?;
                    objstm_cache.insert(container, unpacked);
                }
                let stm = objstm_cache.get(&container)?;
                let rel = *stm.offsets.get(&page_id.0)?;
                let (d0, d1) = extract_raw_dict(&stm.data, stm.first + rel)?;
                (0u16, stm.data[d0..d1].to_vec())
            }
            _ => return None,
        };
        let patched_dict = patch_rotate_in_raw_dict(&raw_dict, new_angle)?;
        patched.push((page_id.0, obj_gen, patched_dict));
    }

    let mut out = Vec::with_capacity(pdf_bytes.len() + patched.len() * 256 + 512);
    out.extend_from_slice(pdf_bytes);
    if !out.ends_with(b"\n") {
        out.push(b'\n');
    }

    let mut written: Vec<(u32, u16, usize)> = Vec::with_capacity(patched.len() + 1);
    let mut max_obj_num = doc.reference_table.size.saturating_sub(1);
    for (obj_num, obj_gen, dict_bytes) in patched {
        max_obj_num = max_obj_num.max(obj_num);
        let off = out.len();
        let _ = write!(&mut out, "{obj_num} {obj_gen} obj\n");
        out.extend_from_slice(&dict_bytes);
        out.extend_from_slice(b"\nendobj\n");
        written.push((obj_num, obj_gen, off));
    }

    let mut extra_trailer = String::new();
    if let Ok(Object::Reference(info_id)) = doc.trailer.get(b"Info") {
        let _ = write!(&mut extra_trailer, " /Info {} {} R", info_id.0, info_id.1);
    }

    match doc.reference_table.cross_reference_type {
        XrefType::CrossReferenceTable => {
            written.sort_by_key(|&(n, _, _)| n);
            let xref_offset = out.len();
            let size = max_obj_num + 1;
            out.extend_from_slice(b"xref\n");
            for (obj_num, obj_gen, off) in written {
                let _ = write!(&mut out, "{obj_num} 1\n{off:010} {obj_gen:05} n \n");
            }
            let _ = write!(
                &mut out,
                "trailer\n<</Size {size} /Root {} {} R /Prev {prev_xref}{extra_trailer}>>\nstartxref\n{xref_offset}\n%%EOF\n",
                root_id.0, root_id.1
            );
        }
        XrefType::CrossReferenceStream => {
            let xref_obj_num = max_obj_num + 1;
            let size = xref_obj_num + 1;
            let xref_offset = out.len();
            written.push((xref_obj_num, 0, xref_offset));
            written.sort_by_key(|&(n, _, _)| n);

            let use_64 = xref_offset > u32::MAX as usize;
            let off_w: usize = if use_64 { 8 } else { 4 };
            let mut index_str = String::new();
            let mut stream = Vec::with_capacity(written.len() * (1 + off_w + 2));
            for (idx, (obj_num, obj_gen, off)) in written.iter().enumerate() {
                if idx > 0 {
                    index_str.push(' ');
                }
                let _ = write!(&mut index_str, "{obj_num} 1");
                stream.push(1u8);
                if use_64 {
                    stream.extend_from_slice(&(*off as u64).to_be_bytes());
                } else {
                    stream.extend_from_slice(&(*off as u32).to_be_bytes());
                }
                stream.extend_from_slice(&obj_gen.to_be_bytes());
            }
            let _ = write!(
                &mut out,
                "{xref_obj_num} 0 obj\n<</Type /XRef /Size {size} /Root {} {} R /Prev {prev_xref}{extra_trailer} /W [1 {off_w} 2] /Index [{index_str}] /Length {}>>\nstream\n",
                root_id.0,
                root_id.1,
                stream.len()
            );
            out.extend_from_slice(&stream);
            let _ = write!(
                &mut out,
                "\nendstream\nendobj\nstartxref\n{xref_offset}\n%%EOF\n"
            );
        }
    }

    Some(out)
}

/// Rotates landscape pages 90 degrees clockwise (`/Rotate` + 90 mod 360) based
/// on the visible box (`CropBox` falling back to `MediaBox`, matching pdf-lib).
/// Uses a lossless incremental update when possible so untouched objects and
/// exact floating-point `/MediaBox` values stay byte-identical.
/// Returns `(None, 0)` when no page is landscape.
pub fn rotate_landscape_faces(pdf_bytes: &[u8]) -> Result<(Option<Vec<u8>>, u32), String> {
    let mut doc = load_unencrypted(pdf_bytes)?;
    let pages: BTreeMap<u32, ObjectId> = doc.get_pages();
    let mut updates: Vec<(ObjectId, i32)> = Vec::new();

    for (_num, page_id) in pages {
        let box_rect = resolve_inherited(&doc, page_id, b"CropBox")
            .and_then(|o| parse_box(&doc, o))
            .or_else(|| {
                resolve_inherited(&doc, page_id, b"MediaBox").and_then(|o| parse_box(&doc, o))
            })
            .ok_or_else(|| "page is missing /MediaBox".to_string())?;
        let angle = resolve_inherited(&doc, page_id, b"Rotate")
            .and_then(|o| as_f64(&doc, o))
            .map(normalize_rotation)
            .unwrap_or(0);
        let w = box_rect.right - box_rect.left;
        let h = box_rect.top - box_rect.bottom;
        let (shown_w, shown_h) = if angle % 180 == 0 { (w, h) } else { (h, w) };
        if shown_w > shown_h {
            updates.push((page_id, (angle + 90) % 360));
        }
    }

    if updates.is_empty() {
        return Ok((None, 0));
    }

    let rotated = updates.len() as u32;
    if let Some(incremental) = try_incremental_rotate(pdf_bytes, &doc, &updates) {
        return Ok((Some(incremental), rotated));
    }

    for (page_id, new_angle) in updates {
        if let Some(Object::Dictionary(dict)) = doc.objects.get_mut(&page_id) {
            dict.set("Rotate", Object::Integer(new_angle as i64));
        }
    }

    let mut saved = Vec::new();
    doc.save_to(&mut saved)
        .map_err(|e| format!("failed to serialize rotated PDF: {e}"))?;
    Ok((Some(saved), rotated))
}

fn embed_png_xobject(doc: &mut Document, png_bytes: &[u8]) -> Result<ObjectId, String> {
    let decoded = decode_png_rgb_alpha(png_bytes)?;
    let smask_id = if let Some(alpha) = decoded.alpha {
        let compressed = zlib_compress_fast(&alpha)?;
        let mut smask_dict = Dictionary::new();
        smask_dict.set("Type", Object::Name(b"XObject".to_vec()));
        smask_dict.set("Subtype", Object::Name(b"Image".to_vec()));
        smask_dict.set("Width", Object::Integer(decoded.width as i64));
        smask_dict.set("Height", Object::Integer(decoded.height as i64));
        smask_dict.set("ColorSpace", Object::Name(b"DeviceGray".to_vec()));
        smask_dict.set("BitsPerComponent", Object::Integer(8));
        smask_dict.set("Filter", Object::Name(b"FlateDecode".to_vec()));
        smask_dict.set("Length", Object::Integer(compressed.len() as i64));
        Some(doc.add_object(Object::Stream(Stream::new(smask_dict, compressed))))
    } else {
        None
    };

    let compressed_rgb = zlib_compress_fast(&decoded.rgb)?;
    let mut img_dict = Dictionary::new();
    img_dict.set("Type", Object::Name(b"XObject".to_vec()));
    img_dict.set("Subtype", Object::Name(b"Image".to_vec()));
    img_dict.set("Width", Object::Integer(decoded.width as i64));
    img_dict.set("Height", Object::Integer(decoded.height as i64));
    img_dict.set("ColorSpace", Object::Name(b"DeviceRGB".to_vec()));
    img_dict.set("BitsPerComponent", Object::Integer(8));
    img_dict.set("Filter", Object::Name(b"FlateDecode".to_vec()));
    img_dict.set("Length", Object::Integer(compressed_rgb.len() as i64));
    if let Some(sid) = smask_id {
        img_dict.set("SMask", Object::Reference(sid));
    }
    Ok(doc.add_object(Object::Stream(Stream::new(img_dict, compressed_rgb))))
}

/// Stamps pre-rendered PNG overlays (watermark, header/footer) onto pages of `pdf_bytes`.
/// Each unique stamp PNG is embedded once as an Image XObject (with `/SMask` for alpha).
pub fn stamp_pdf_overlays(
    pdf_bytes: &[u8],
    per_face: &[Vec<OverlayPlacementDto>],
    stamps: &[&[u8]],
) -> Result<Vec<u8>, String> {
    if per_face.iter().all(|list| list.is_empty()) {
        return Ok(pdf_bytes.to_vec());
    }
    let mut doc = load_unencrypted(pdf_bytes)?;
    let infos = collect_page_infos(&doc)?;

    let mut embedded_stamps: HashMap<usize, ObjectId> = HashMap::new();
    let mut gstates: HashMap<u32, ObjectId> = HashMap::new();

    // Shared q / Q streams so existing page CTM mutations never leak into overlays.
    let q_open_id = {
        let mut d = Dictionary::new();
        d.set("Length", Object::Integer(2));
        doc.add_object(Object::Stream(Stream::new(d, b"q\n".to_vec())))
    };
    let q_close_id = {
        let mut d = Dictionary::new();
        d.set("Length", Object::Integer(3));
        doc.add_object(Object::Stream(Stream::new(d, b"\nQ\n".to_vec())))
    };

    for (idx, info) in infos.iter().enumerate() {
        let Some(placements) = per_face.get(idx) else {
            continue;
        };
        if placements.is_empty() {
            continue;
        }

        // Resolve/clone the page's Resources dictionary (inheriting if needed).
        let mut res_dict = match resolve_inherited(&doc, info.page_id, b"Resources")
            .and_then(|o| resolve_object(&doc, o))
        {
            Some(Object::Dictionary(d)) => d.clone(),
            _ => Dictionary::new(),
        };
        let mut xobjs = match res_dict.get(b"XObject").ok().and_then(|o| resolve_object(&doc, o)) {
            Some(Object::Dictionary(d)) => d.clone(),
            _ => Dictionary::new(),
        };
        let mut ext_gs = match res_dict
            .get(b"ExtGState")
            .ok()
            .and_then(|o| resolve_object(&doc, o))
        {
            Some(Object::Dictionary(d)) => d.clone(),
            _ => Dictionary::new(),
        };

        let mut overlay_ops = String::new();
        for (p_idx, p) in placements.iter().enumerate() {
            let Some(&stamp_bytes) = stamps.get(p.stamp_index) else {
                return Err(format!("overlay stamp index {} out of range", p.stamp_index));
            };
            let img_id = match embedded_stamps.get(&p.stamp_index) {
                Some(&id) => id,
                None => {
                    let id = embed_png_xobject(&mut doc, stamp_bytes)?;
                    embedded_stamps.insert(p.stamp_index, id);
                    id
                }
            };
            let xname = format!("IeumOv{p_idx}");
            xobjs.set(xname.as_bytes(), Object::Reference(img_id));

            let opacity = p.opacity.unwrap_or(1.0).clamp(0.0, 1.0);
            let gs_cmd = if opacity < 0.999 {
                let key = (opacity * 1000.0).round() as u32;
                let gs_id = match gstates.get(&key) {
                    Some(&id) => id,
                    None => {
                        let mut gd = Dictionary::new();
                        gd.set("Type", Object::Name(b"ExtGState".to_vec()));
                        gd.set("ca", Object::Real(opacity as f32));
                        gd.set("CA", Object::Real(opacity as f32));
                        let id = doc.add_object(Object::Dictionary(gd));
                        gstates.insert(key, id);
                        id
                    }
                };
                let gs_name = format!("IeumGs{key}");
                ext_gs.set(gs_name.as_bytes(), Object::Reference(gs_id));
                format!("/{gs_name} gs\n")
            } else {
                String::new()
            };

            let face_w = info.size.width_pt;
            let face_h = info.size.height_pt;
            let tx = p.x.unwrap_or(0.0);
            let ty = p.y.unwrap_or(0.0);
            let tw = p.width.unwrap_or(face_w);
            let th = p.height.unwrap_or(face_h);
            let dx = tx;
            let dy = face_h - ty - th;
            let bl = info.vis_box.left;
            let bb = info.vis_box.bottom;
            let br = info.vis_box.right;
            let bt = info.vis_box.top;

            let (a, b, c, d, e, f) = match info.rotate {
                90 => (0.0, tw, -th, 0.0, br - dy, bb + dx),
                180 => (-tw, 0.0, 0.0, -th, br - dx, bt - dy),
                270 => (0.0, -tw, th, 0.0, bl + dy, bt - dx),
                _ => (tw, 0.0, 0.0, th, bl + dx, bb + dy),
            };
            let _ = writeln!(
                &mut overlay_ops,
                "q\n{gs_cmd}{} {} {} {} {} {} cm\n/{xname} Do\nQ",
                format_pdf_num(a),
                format_pdf_num(b),
                format_pdf_num(c),
                format_pdf_num(d),
                format_pdf_num(e),
                format_pdf_num(f),
            );
        }

        res_dict.set("XObject", Object::Dictionary(xobjs));
        if !ext_gs.is_empty() {
            res_dict.set("ExtGState", Object::Dictionary(ext_gs));
        }

        let ov_bytes = overlay_ops.into_bytes();
        let mut ov_dict = Dictionary::new();
        ov_dict.set("Length", Object::Integer(ov_bytes.len() as i64));
        let ov_stream_id = doc.add_object(Object::Stream(Stream::new(ov_dict, ov_bytes)));

        // Collect existing Contents references so we wrap them in q ... Q before stamping.
        let existing_contents: Vec<Object> = match resolve_dict(&doc, info.page_id)
            .and_then(|d| d.get(b"Contents").ok())
            .cloned()
        {
            Some(Object::Reference(rid)) => match doc.objects.get(&rid) {
                Some(Object::Array(arr)) => arr.clone(),
                _ => vec![Object::Reference(rid)],
            },
            Some(Object::Array(arr)) => arr,
            _ => Vec::new(),
        };

        let mut new_contents = Vec::with_capacity(existing_contents.len() + 3);
        if !existing_contents.is_empty() {
            new_contents.push(Object::Reference(q_open_id));
            new_contents.extend(existing_contents);
            new_contents.push(Object::Reference(q_close_id));
        }
        new_contents.push(Object::Reference(ov_stream_id));

        if let Some(Object::Dictionary(page_dict)) = doc.objects.get_mut(&info.page_id) {
            page_dict.set("Resources", Object::Dictionary(res_dict));
            page_dict.set("Contents", Object::Array(new_contents));
        }
    }

    let mut saved = Vec::new();
    doc.save_to(&mut saved)
        .map_err(|e| format!("failed to serialize overlaid PDF: {e}"))?;
    Ok(saved)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_minimal_pdf(pages: &[(f32, f32, i32)], shared_resource: bool) -> Vec<u8> {
        let mut doc = Document::with_version("1.5");
        let pages_id = doc.new_object_id();
        let font_id = doc.add_object(Object::Dictionary(Dictionary::from_iter(vec![
            ("Type", Object::Name(b"Font".to_vec())),
            ("Subtype", Object::Name(b"Type1".to_vec())),
            ("BaseFont", Object::Name(b"Helvetica".to_vec())),
        ])));
        let big_stream = if shared_resource {
            let mut d = Dictionary::new();
            d.set("Type", Object::Name(b"XObject".to_vec()));
            d.set("Subtype", Object::Name(b"Image".to_vec()));
            let payload = vec![0xABu8; 32 * 1024];
            d.set("Length", Object::Integer(payload.len() as i64));
            Some(doc.add_object(Object::Stream(Stream::new(d, payload))))
        } else {
            None
        };

        let mut kids = Vec::new();
        for (i, &(w, h, rot)) in pages.iter().enumerate() {
            let text = format!("BT /F1 12 Tf 10 10 Td (P{}) Tj ET", i + 1);
            let mut cd = Dictionary::new();
            cd.set("Length", Object::Integer(text.len() as i64));
            let cid = doc.add_object(Object::Stream(Stream::new(cd, text.into_bytes())));

            let mut fonts = Dictionary::new();
            fonts.set("F1", Object::Reference(font_id));
            let mut res = Dictionary::new();
            res.set("Font", Object::Dictionary(fonts));
            if let Some(img_id) = big_stream {
                let mut xobjs = Dictionary::new();
                xobjs.set("Im0", Object::Reference(img_id));
                res.set("XObject", Object::Dictionary(xobjs));
            }
            let mut pd = Dictionary::new();
            pd.set("Type", Object::Name(b"Page".to_vec()));
            pd.set("Parent", Object::Reference(pages_id));
            pd.set(
                "MediaBox",
                Object::Array(vec![
                    Object::Integer(0),
                    Object::Integer(0),
                    Object::Real(w),
                    Object::Real(h),
                ]),
            );
            if rot != 0 {
                pd.set("Rotate", Object::Integer(rot as i64));
            }
            pd.set("Resources", Object::Dictionary(res));
            pd.set("Contents", Object::Reference(cid));
            kids.push(Object::Reference(doc.add_object(Object::Dictionary(pd))));
        }

        let mut pages_dict = Dictionary::new();
        pages_dict.set("Type", Object::Name(b"Pages".to_vec()));
        pages_dict.set("Count", Object::Integer(kids.len() as i64));
        pages_dict.set("Kids", Object::Array(kids));
        doc.objects.insert(pages_id, Object::Dictionary(pages_dict));
        let mut catalog = Dictionary::new();
        catalog.set("Type", Object::Name(b"Catalog".to_vec()));
        catalog.set("Pages", Object::Reference(pages_id));
        let cid = doc.add_object(Object::Dictionary(catalog));
        doc.trailer.set("Root", Object::Reference(cid));

        let mut bytes = Vec::new();
        doc.save_to(&mut bytes).unwrap();
        bytes
    }

    #[test]
    fn reads_sizes_with_rotation_and_deduplicates_shared_resources() {
        let pages: Vec<(f32, f32, i32)> = (0..20).map(|i| (595.0, 842.0, if i == 1 { 90 } else { 0 })).collect();
        let src = make_minimal_pdf(&pages, true);
        let sizes = read_job_page_sizes(&src).unwrap();
        assert_eq!(sizes.len(), 20);
        assert!((sizes[0].width_pt - 595.0).abs() < 1e-3);
        assert!((sizes[1].width_pt - 842.0).abs() < 1e-3);

        // Arrange all 20 pages into 10 2-up faces.
        let mut faces = Vec::new();
        for f in 0..10 {
            faces.push(PlannedFaceDto {
                width: 842.0,
                height: 595.0,
                cells: vec![
                    PlacedCellDto {
                        box_rect: RectDto { x: 0.0, y: 0.0, width: 421.0, height: 595.0 },
                        page_index: Some(f * 2),
                        content: Some(RectDto { x: 0.0, y: 0.0, width: 421.0, height: 595.0 }),
                    },
                    PlacedCellDto {
                        box_rect: RectDto { x: 421.0, y: 0.0, width: 421.0, height: 595.0 },
                        page_index: Some(f * 2 + 1),
                        content: Some(RectDto { x: 421.0, y: 0.0, width: 421.0, height: 595.0 }),
                    },
                ],
                cut_marks: vec![],
                cell_borders: vec![],
                tile_label: None,
            });
        }
        let arranged = arrange_pdf(&src, &faces).unwrap();
        // Shared 32 KB stream must only be stored ONCE, not 20x (640 KB).
        assert!(arranged.len() < src.len() + 64 * 1024, "output bloated: {} vs {}", arranged.len(), src.len());

        let (rotated_bytes, count) = rotate_landscape_faces(&arranged).unwrap();
        assert_eq!(count, 10);
        assert!(rotated_bytes.is_some());
    }

    #[test]
    fn draws_cell_borders_tile_labels_and_stamps_overlays() {
        let src = make_minimal_pdf(&[(595.0, 842.0, 0), (595.0, 842.0, 0)], false);
        let faces = vec![PlannedFaceDto {
            width: 842.0,
            height: 595.0,
            cells: vec![PlacedCellDto {
                box_rect: RectDto { x: 0.0, y: 0.0, width: 421.0, height: 595.0 },
                page_index: Some(0),
                content: Some(RectDto { x: 0.0, y: 0.0, width: 421.0, height: 595.0 }),
            }],
            cut_marks: vec![],
            cell_borders: vec![RectDto { x: 0.25, y: 0.25, width: 420.5, height: 594.5 }],
            tile_label: Some("(1-1)".to_string()),
        }];
        let arranged = arrange_pdf(&src, &faces).unwrap();
        let stamp_png = crate::pixels::encode_png(&[255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 0], 2, 2, 3).unwrap();
        let stamped = stamp_pdf_overlays(
            &arranged,
            &[vec![OverlayPlacementDto {
                stamp_index: 0,
                x: Some(10.0),
                y: Some(10.0),
                width: Some(100.0),
                height: Some(100.0),
                opacity: Some(0.3),
            }]],
            &[stamp_png.as_slice()],
        )
        .unwrap();
        let doc = Document::load_mem(&stamped).unwrap();
        assert_eq!(doc.get_pages().len(), 1);
    }
}
