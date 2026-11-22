//! Models the app installs when the user asks for them. Each one is pinned in
//! the code by its size and SHA-256: a download is written to a `.part` file
//! and only moved into place once both match. Only the model itself is
//! requested; no audio or transcript is sent.
//!
//! The pin is checked again at load time only where a caller uses
//! `read_verified`. Today that is the speaker model alone, which is hashed
//! before every load and parsed from the checked bytes. The Whisper model is
//! checked against its pin when it is downloaded; when it is loaded,
//! `local_engine` only checks its size and GGML magic number before
//! whisper.cpp opens the file.
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::{self, Read, Write},
    path::{Path, PathBuf},
    sync::Mutex,
};
use tauri::Emitter;

/// A published model file and what it must be once it is on disk.
pub struct PinnedModel {
    pub url: &'static str,
    pub sha256: &'static str,
    pub size: u64,
}

/// Destinations being downloaded right now: two downloads of the same model
/// would write the same `.part` file.
static DOWNLOADING: Mutex<Vec<PathBuf>> = Mutex::new(Vec::new());

/// Marks a destination as being downloaded until it is dropped.
struct Downloading(PathBuf);

impl Downloading {
    fn start(dest: &Path) -> Result<Self, String> {
        let mut busy = DOWNLOADING
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if busy.iter().any(|path| path == dest) {
            return Err("A model download is already running.".into());
        }
        busy.push(dest.to_path_buf());
        Ok(Self(dest.to_path_buf()))
    }
}

impl Drop for Downloading {
    fn drop(&mut self) {
        DOWNLOADING
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .retain(|path| *path != self.0);
    }
}

/// Downloads `model` to `dest`, announcing the percentage done with `event`.
pub fn download_verified(
    app: &tauri::AppHandle,
    model: &PinnedModel,
    dest: &Path,
    event: &str,
) -> Result<(), String> {
    let _downloading = Downloading::start(dest)?;
    fs::create_dir_all(dest.parent().ok_or("Invalid model directory")?)
        .map_err(|e| e.to_string())?;
    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(600))
        .build()
        .map_err(|e| e.to_string())?;
    let response = client
        .get(model.url)
        .send()
        .and_then(|r| r.error_for_status())
        .map_err(|e| format!("Model download failed: {e}"))?;
    save_verified(response, model, dest, |percent| {
        let _ = app.emit(event, percent);
    })?;
    let _ = app.emit(event, 100u32);
    Ok(())
}

/// Where a download is written until it has been checked.
fn partial_path(dest: &Path) -> PathBuf {
    let mut name = dest.file_name().unwrap_or_default().to_os_string();
    name.push(".part");
    dest.with_file_name(name)
}

fn hex(digest: &[u8]) -> String {
    digest.iter().map(|byte| format!("{byte:02x}")).collect()
}

/// Writes `source` to `dest` by way of a `.part` file that is renamed only
/// when its size and SHA-256 match the pin. On any failure the `.part` file
/// is removed and `dest` is left as it was.
fn save_verified(
    mut source: impl Read,
    model: &PinnedModel,
    dest: &Path,
    mut progress: impl FnMut(u32),
) -> Result<(), String> {
    let partial = partial_path(dest);
    let result = (|| -> Result<(), String> {
        let mut file = fs::File::create(&partial).map_err(|e| e.to_string())?;
        let mut hash = Sha256::new();
        let mut downloaded = 0u64;
        let mut buffer = vec![0u8; 65536];
        let mut last_progress = 0;
        loop {
            let count = source
                .read(&mut buffer)
                .map_err(|e| format!("Model download failed: {e}"))?;
            if count == 0 {
                break;
            }
            downloaded += count as u64;
            if downloaded > model.size {
                return Err("Model exceeded its expected size.".into());
            }
            hash.update(&buffer[..count]);
            file.write_all(&buffer[..count])
                .map_err(|e| e.to_string())?;
            if downloaded - last_progress > 1_000_000 {
                progress((downloaded * 100 / model.size) as u32);
                last_progress = downloaded;
            }
        }
        file.sync_all().map_err(|e| e.to_string())?;
        drop(file);
        if downloaded != model.size || hex(&hash.finalize()) != model.sha256 {
            return Err("Model checksum failed. Please retry the download.".into());
        }
        fs::rename(&partial, dest).map_err(|e| e.to_string())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&partial);
    }
    result
}

/// Why a model on disk cannot be used.
#[derive(Debug, PartialEq)]
pub enum Unusable {
    Missing,
    /// Not the pinned file: another size or another hash.
    Mismatch,
    Unreadable(String),
}

/// The bytes of the model at `path`, once their size and SHA-256 match the
/// pin. A file of the wrong size is not read at all.
pub fn read_verified(path: &Path, model: &PinnedModel) -> Result<Vec<u8>, Unusable> {
    let size = match fs::metadata(path) {
        Ok(metadata) if metadata.is_file() => metadata.len(),
        Ok(_) => return Err(Unusable::Mismatch),
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Err(Unusable::Missing),
        Err(error) => return Err(Unusable::Unreadable(error.to_string())),
    };
    if size != model.size {
        return Err(Unusable::Mismatch);
    }
    let bytes = fs::read(path).map_err(|error| Unusable::Unreadable(error.to_string()))?;
    if bytes.len() as u64 != model.size || hex(&Sha256::digest(&bytes)) != model.sha256 {
        return Err(Unusable::Mismatch);
    }
    Ok(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    fn pin(data: &[u8]) -> PinnedModel {
        PinnedModel {
            url: "https://example.invalid/model",
            sha256: hex(&Sha256::digest(data)).leak(),
            size: data.len() as u64,
        }
    }

    fn model_bytes() -> Vec<u8> {
        (0..3_000_000u32).map(|i| (i * 7 % 251) as u8).collect()
    }

    #[test]
    fn a_matching_download_is_moved_into_place() {
        let folder = tempfile::tempdir().unwrap();
        let dest = folder.path().join("model.onnx");
        let data = model_bytes();
        let mut seen = vec![];
        save_verified(Cursor::new(data.clone()), &pin(&data), &dest, |percent| {
            seen.push(percent)
        })
        .unwrap();
        assert_eq!(fs::read(&dest).unwrap(), data);
        assert!(!folder.path().join("model.onnx.part").exists());
        assert!(!seen.is_empty() && seen.windows(2).all(|pair| pair[0] < pair[1]));
        assert_eq!(read_verified(&dest, &pin(&data)), Ok(data));
    }

    #[test]
    fn a_download_with_the_wrong_hash_or_size_is_thrown_away() {
        let folder = tempfile::tempdir().unwrap();
        let dest = folder.path().join("model.onnx");
        let data = model_bytes();
        let mut damaged = data.clone();
        damaged[1234] ^= 1;
        let checksum = "Model checksum failed. Please retry the download.";
        assert_eq!(
            save_verified(Cursor::new(damaged), &pin(&data), &dest, |_| {}).unwrap_err(),
            checksum
        );
        assert_eq!(
            save_verified(Cursor::new(&data[..1000]), &pin(&data), &dest, |_| {}).unwrap_err(),
            checksum
        );
        let mut longer = data.clone();
        longer.push(0);
        assert_eq!(
            save_verified(Cursor::new(longer), &pin(&data), &dest, |_| {}).unwrap_err(),
            "Model exceeded its expected size."
        );
        assert!(!dest.exists());
        assert!(!folder.path().join("model.onnx.part").exists());
    }

    #[test]
    fn a_model_is_checked_again_before_it_is_read() {
        let folder = tempfile::tempdir().unwrap();
        let path = folder.path().join("model.onnx");
        let data = model_bytes();
        assert_eq!(read_verified(&path, &pin(&data)), Err(Unusable::Missing));
        let mut damaged = data.clone();
        damaged[0] ^= 1;
        fs::write(&path, &damaged).unwrap();
        assert_eq!(read_verified(&path, &pin(&data)), Err(Unusable::Mismatch));
        fs::write(&path, &data[..10]).unwrap();
        assert_eq!(read_verified(&path, &pin(&data)), Err(Unusable::Mismatch));
        assert_eq!(
            read_verified(folder.path(), &pin(&data)),
            Err(Unusable::Mismatch)
        );
    }

    #[test]
    fn one_download_of_a_model_at_a_time() {
        let folder = tempfile::tempdir().unwrap();
        let dest = folder.path().join("model.onnx");
        let first = Downloading::start(&dest).unwrap();
        assert_eq!(
            Downloading::start(&dest).err().unwrap(),
            "A model download is already running."
        );
        // Another model can download meanwhile.
        let other = Downloading::start(&folder.path().join("other.bin")).unwrap();
        drop(first);
        assert!(Downloading::start(&dest).is_ok());
        drop(other);
    }
}
