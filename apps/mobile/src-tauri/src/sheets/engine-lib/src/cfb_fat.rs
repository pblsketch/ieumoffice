//! FAT fix-up for compound files written by SheetJS `cfb` (what the desktop's
//! `officecrypto-tool` uses to write password-protected workbooks).
//!
//! SheetJS writes ENDOFCHAIN (0xFFFFFFFE) into every FAT slot that lies past
//! the end of the file. Excel and `officecrypto-tool` accept that; the Rust
//! `cfb` crate behind `msoffice-crypto` rejects the container ("Malformed
//! FAT"), so without this no workbook the desktop encrypted would open on the
//! phone. The fix-up rewrites exactly those slots to FREESECT (0xFFFFFFFF) in
//! the caller's copy of the bytes; no stream data, directory entry or
//! in-file slot changes. From the XLS-T4 prototype.

const CFB_MAGIC: [u8; 8] = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const ENDOFCHAIN: u32 = 0xFFFF_FFFE;
const FREESECT: u32 = 0xFFFF_FFFF;
/// Sector ids from here up are markers (DIFSECT, FATSECT, ENDOFCHAIN, FREESECT).
const MAX_REGULAR_SECTOR: u32 = 0xFFFF_FFFA;
/// FAT sector ids the header itself holds.
const HEADER_DIFAT_SLOTS: usize = 109;
const HEADER_DIFAT_OFFSET: usize = 76;
const FIRST_DIFAT_SECTOR_OFFSET: usize = 68;
const SECTOR_SHIFT_OFFSET: usize = 30;

pub fn is_cfb(bytes: &[u8]) -> bool {
    bytes.len() >= CFB_MAGIC.len() && bytes[..CFB_MAGIC.len()] == CFB_MAGIC
}

fn read_u32(bytes: &[u8], offset: usize) -> Option<u32> {
    let slot = bytes.get(offset..offset.checked_add(4)?)?;
    Some(u32::from_le_bytes([slot[0], slot[1], slot[2], slot[3]]))
}

/// Rewrites the ENDOFCHAIN slots past the end of the file to FREESECT.
/// Returns how many slots changed (0 when nothing needed fixing, or when the
/// bytes are not a compound file this can read).
pub fn normalize_fat(bytes: &mut [u8]) -> usize {
    if bytes.len() < 512 || !is_cfb(bytes) {
        return 0;
    }
    let shift = u16::from_le_bytes([bytes[SECTOR_SHIFT_OFFSET], bytes[SECTOR_SHIFT_OFFSET + 1]]);
    if shift != 9 && shift != 12 {
        return 0;
    }
    let sector_size = 1usize << shift;
    // Version 3 files have a 512-byte header in a 512-byte sector; version 4
    // pads the header to a full 4096-byte sector.
    let header = sector_size;
    if bytes.len() <= header {
        return 0;
    }
    let sectors_in_file = (bytes.len() - header).div_ceil(sector_size);
    let sector_offset = |sector: u32| header + sector as usize * sector_size;

    let mut fat_sectors = Vec::new();
    for index in 0..HEADER_DIFAT_SLOTS {
        if let Some(sector) = read_u32(bytes, HEADER_DIFAT_OFFSET + 4 * index) {
            if sector < MAX_REGULAR_SECTOR {
                fat_sectors.push(sector);
            }
        }
    }
    let ids_per_difat_sector = sector_size / 4 - 1;
    let mut difat = read_u32(bytes, FIRST_DIFAT_SECTOR_OFFSET).unwrap_or(ENDOFCHAIN);
    let mut hops = 0usize;
    while difat < MAX_REGULAR_SECTOR && (difat as usize) < sectors_in_file && hops < sectors_in_file
    {
        let offset = sector_offset(difat);
        for index in 0..ids_per_difat_sector {
            if let Some(sector) = read_u32(bytes, offset + 4 * index) {
                if sector < MAX_REGULAR_SECTOR {
                    fat_sectors.push(sector);
                }
            }
        }
        difat = read_u32(bytes, offset + 4 * ids_per_difat_sector).unwrap_or(ENDOFCHAIN);
        hops += 1;
    }

    let mut fixed = 0;
    let mut slot_index = 0usize;
    for sector in fat_sectors {
        let offset = sector_offset(sector);
        for index in 0..sector_size / 4 {
            let at = offset + 4 * index;
            if slot_index >= sectors_in_file && read_u32(bytes, at) == Some(ENDOFCHAIN) {
                bytes[at..at + 4].copy_from_slice(&FREESECT.to_le_bytes());
                fixed += 1;
            }
            slot_index += 1;
        }
    }
    fixed
}
