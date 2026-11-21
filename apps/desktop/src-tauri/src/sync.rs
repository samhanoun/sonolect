//! Note sync, the native half.
//!
//! The webview runs the sync engine (`@sonolect/sync-core`): it derives the
//! vault keys from the root key, seals and opens every record and decides what
//! to send. This module keeps the root key in the OS keychain, keeps the
//! engine's state on disk and carries its requests to the sync server fixed
//! when the app was built. Requests carry only the bearer token and
//! ciphertext, and nothing here logs a body or a token.
//!
//! Without a server URL in the build, every command is inert: it touches
//! neither the keychain nor the disk, and nothing reaches the network.
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use serde::{Deserialize, Serialize};
use std::{
    cmp::Ordering,
    collections::BTreeMap,
    fs,
    io::Read,
    path::{Path, PathBuf},
    sync::{Mutex, MutexGuard, OnceLock},
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::Manager;

/// The sync server, from `SONOLECT_SYNC_URL` when the app was built.
const BUILD_URL: Option<&str> = option_env!("SONOLECT_SYNC_URL");
/// Plain http, to this machine only, is for development builds.
const LOCAL_HTTP_HOSTS: [&str; 2] = ["127.0.0.1", "localhost"];

const KEYCHAIN_SERVICE: &str = "com.sonolect.local.sync";
const KEYCHAIN_ACCOUNT: &str = "vault-root";

const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);
const MAX_REQUEST_BYTES: usize = 5 * 1024 * 1024;
const MAX_RESPONSE_BYTES: usize = 8 * 1024 * 1024;
/// One saved piece of the engine's state (its meta, or one bucket of records).
const MAX_STATE_VALUE_BYTES: usize = 16 * 1024 * 1024;

const NOT_AVAILABLE: &str = "Sync is not available in this version of Sonolect.";
#[cfg(target_os = "linux")]
const KEYCHAIN_UNAVAILABLE: &str = "Sync is unavailable on this system: it keeps its key in a keychain (Secret Service, such as GNOME Keyring or KWallet), and none is running.";
#[cfg(not(target_os = "linux"))]
const KEYCHAIN_UNAVAILABLE: &str =
    "Sync is unavailable on this system: the keychain could not be opened.";
const KEYCHAIN_FAILED: &str = "The sync key could not be read or saved in the keychain.";
const INVALID_KEY: &str = "This is not a valid sync key.";
const KEY_EXISTS: &str = "Sync is already on with another key. Turn it off first.";
const STATE_FAILED: &str = "The sync state could not be saved.";
const INTERRUPTED: &str = "Sync was interrupted.";

// ── Server URL ─────────────────────────────────────────────────────────

/// Why a configured URL is refused: the reasons of sync-core's
/// `checkSyncServerUrl`, which this check mirrors.
#[derive(Debug, PartialEq, Eq)]
enum UrlProblem {
    Missing,
    Invalid,
    Insecure,
}

/// Checks a sync server URL: `scheme://host[:port][/path]` with no user
/// info, query or fragment; https, or plain http to this machine when
/// `allow_local_http` (a debug build). Returns it without a trailing slash.
fn check_server_url(raw: Option<&str>, allow_local_http: bool) -> Result<String, UrlProblem> {
    let value = raw.unwrap_or_default().trim();
    if value.is_empty() {
        return Err(UrlProblem::Missing);
    }
    let (scheme, rest) = value.split_once("://").ok_or(UrlProblem::Invalid)?;
    let scheme = scheme.to_ascii_lowercase();
    if scheme != "https" && scheme != "http" {
        return Err(UrlProblem::Invalid);
    }
    let (authority, path) = rest.find('/').map_or((rest, ""), |at| rest.split_at(at));
    let (host, port) = if let Some(inner) = authority.strip_prefix('[') {
        let (address, after) = inner.split_once(']').ok_or(UrlProblem::Invalid)?;
        if address.is_empty()
            || !address
                .bytes()
                .all(|b| b.is_ascii_hexdigit() || b == b':' || b == b'.')
        {
            return Err(UrlProblem::Invalid);
        }
        let port = match after {
            "" => None,
            after => Some(after.strip_prefix(':').ok_or(UrlProblem::Invalid)?),
        };
        (format!("[{}]", address.to_ascii_lowercase()), port)
    } else {
        let (host, port) = match authority.rsplit_once(':') {
            Some((host, port)) => (host, Some(port)),
            None => (authority, None),
        };
        if host.is_empty()
            || !host
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'.' || b == b'-')
            || host.starts_with('.')
            || host.ends_with('.')
            || host.contains("..")
        {
            return Err(UrlProblem::Invalid);
        }
        (host.to_ascii_lowercase(), port)
    };
    let port = match port {
        None => String::new(),
        Some(port) => {
            if port.is_empty() || port.len() > 5 || !port.bytes().all(|b| b.is_ascii_digit()) {
                return Err(UrlProblem::Invalid);
            }
            match port.parse::<u32>() {
                Ok(number) if (1..=65_535).contains(&number) => format!(":{port}"),
                _ => return Err(UrlProblem::Invalid),
            }
        }
    };
    if !path
        .bytes()
        .all(|b| b.is_ascii_alphanumeric() || b"._~!$&'()*+,;=:@%/-".contains(&b))
    {
        return Err(UrlProblem::Invalid);
    }
    if scheme == "http" && !(allow_local_http && LOCAL_HTTP_HOSTS.contains(&host.as_str())) {
        return Err(UrlProblem::Insecure);
    }
    Ok(format!(
        "{scheme}://{host}{port}{}",
        path.trim_end_matches('/')
    ))
}

/// The build's sync server, when it names a usable one.
fn base_url() -> Option<String> {
    check_server_url(BUILD_URL, cfg!(debug_assertions)).ok()
}

/// Whether sync can be offered, and which server it talks to.
#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncConfig {
    available: bool,
    /// The server's host (and port), for the settings screen.
    #[serde(skip_serializing_if = "Option::is_none")]
    server: Option<String>,
}

fn config_for(raw: Option<&str>, allow_local_http: bool) -> SyncConfig {
    match check_server_url(raw, allow_local_http) {
        Ok(url) => {
            let after_scheme = url.split_once("://").map_or("", |(_, rest)| rest);
            SyncConfig {
                available: true,
                server: Some(
                    after_scheme
                        .split('/')
                        .next()
                        .unwrap_or_default()
                        .to_owned(),
                ),
            }
        }
        Err(_) => SyncConfig {
            available: false,
            server: None,
        },
    }
}

#[tauri::command]
pub fn sync_config() -> SyncConfig {
    config_for(BUILD_URL, cfg!(debug_assertions))
}

/// Runs keychain and file work off the main thread.
async fn blocking<T: Send + 'static>(
    work: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|_| INTERRUPTED.to_string())?
}

// ── Root key in the OS keychain ────────────────────────────────────────

fn keychain() -> Result<keyring::Entry, String> {
    keyring::Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT).map_err(keychain_error)
}

fn keychain_error(error: keyring::Error) -> String {
    match error {
        keyring::Error::PlatformFailure(_) | keyring::Error::NoStorageAccess(_) => {
            KEYCHAIN_UNAVAILABLE
        }
        _ => KEYCHAIN_FAILED,
    }
    .into()
}

/// A root key as the webview passes it: 32 bytes as unpadded base64url.
fn checked_root(key: &str) -> Result<String, String> {
    let key = key.trim();
    match URL_SAFE_NO_PAD.decode(key) {
        Ok(bytes) if bytes.len() == 32 => Ok(key.to_owned()),
        _ => Err(INVALID_KEY.into()),
    }
}

/// The saved root key. A damaged entry counts as none, so it can be replaced.
fn read_root(entry: &keyring::Entry) -> Result<Option<String>, String> {
    match entry.get_password() {
        Ok(saved) => Ok(checked_root(&saved).ok()),
        Err(keyring::Error::NoEntry | keyring::Error::BadEncoding(_)) => Ok(None),
        Err(error) => Err(keychain_error(error)),
    }
}

/// Saves the root of a vault this device creates; never replaces another key.
fn create_root(entry: &keyring::Entry, key: &str) -> Result<(), String> {
    let key = checked_root(key)?;
    match read_root(entry)? {
        Some(saved) if saved == key => Ok(()),
        Some(_) => Err(KEY_EXISTS.into()),
        None => entry.set_password(&key).map_err(keychain_error),
    }
}

/// Saves the root read from a pairing code: joining replaces the saved key.
fn import_root(entry: &keyring::Entry, key: &str) -> Result<(), String> {
    let key = checked_root(key)?;
    entry.set_password(&key).map_err(keychain_error)
}

fn forget_root(entry: &keyring::Entry) -> Result<(), String> {
    match entry.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(keychain_error(error)),
    }
}

/// Whether a sync key is saved on this device.
#[tauri::command]
pub async fn sync_key_status() -> Result<bool, String> {
    if base_url().is_none() {
        return Ok(false);
    }
    blocking(|| read_root(&keychain()?).map(|root| root.is_some())).await
}

/// Saves the root key of a new vault (generated in the webview).
#[tauri::command]
pub async fn sync_key_create(key: String) -> Result<(), String> {
    base_url().ok_or(NOT_AVAILABLE)?;
    blocking(move || create_root(&keychain()?, &key)).await
}

/// Saves the root key read from another device's pairing code.
#[tauri::command]
pub async fn sync_key_import(key: String) -> Result<(), String> {
    base_url().ok_or(NOT_AVAILABLE)?;
    blocking(move || import_root(&keychain()?, &key)).await
}

/// The saved root key, for the webview's engine to derive the vault keys
/// (and to show the pairing code on request). It never leaves this device.
#[tauri::command]
pub async fn sync_key_load() -> Result<Option<String>, String> {
    base_url().ok_or(NOT_AVAILABLE)?;
    blocking(|| read_root(&keychain()?)).await
}

#[tauri::command]
pub async fn sync_key_forget() -> Result<(), String> {
    if base_url().is_none() {
        return Ok(());
    }
    blocking(|| forget_root(&keychain()?)).await
}

// ── Sync state on disk ─────────────────────────────────────────────────

/// One HLC (hybrid logical clock) value, as sync-core's `Hlc`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Hlc {
    pub t: u64,
    pub c: u64,
    pub d: String,
}

const MAX_SAFE_INTEGER: u64 = (1 << 53) - 1;

impl Hlc {
    /// The rules of sync-core's `isHlc`.
    pub fn is_valid(&self) -> bool {
        self.t <= MAX_SAFE_INTEGER && self.c <= MAX_SAFE_INTEGER && is_device_id(&self.d)
    }

    /// The order of sync-core's `compareHlc`.
    pub fn order(&self, other: &Hlc) -> Ordering {
        (self.t, self.c, self.d.as_bytes()).cmp(&(other.t, other.c, other.d.as_bytes()))
    }
}

fn is_device_id(id: &str) -> bool {
    (1..=64).contains(&id.len())
        && id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

/// Serializes the writes to the state and delete files.
static FILES: Mutex<()> = Mutex::new(());

fn files_lock() -> MutexGuard<'static, ()> {
    FILES
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// The sync folder in the app's data folder, when this build syncs. It holds
/// `state/` (the engine's state, which exists while sync is on) and
/// `deletes.json` (deletes made on this device, until the engine has them).
pub(super) fn folder(app: &tauri::AppHandle) -> Option<PathBuf> {
    base_url()?;
    app.path()
        .app_local_data_dir()
        .ok()
        .map(|directory| directory.join("sync"))
}

fn require_folder(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    folder(app).ok_or_else(|| NOT_AVAILABLE.into())
}

/// The file for one key of the engine's state: "meta", or "r.<c>", one
/// bucket per first character of a record id. The character is written in
/// hex, so that "r.a" and "r.A" stay two files where names ignore case.
fn state_file(key: &str) -> Option<String> {
    if key == "meta" {
        return Some("meta.json".into());
    }
    let bucket = key.strip_prefix("r.")?.as_bytes();
    match bucket {
        [c] if c.is_ascii_alphanumeric() || *c == b'-' || *c == b'_' => {
            Some(format!("r-{c:02x}.json"))
        }
        _ => None,
    }
}

fn state_key(file: &str) -> Option<String> {
    if file == "meta.json" {
        return Some("meta".into());
    }
    let hex = file.strip_prefix("r-")?.strip_suffix(".json")?;
    let byte = u8::from_str_radix(hex, 16).ok()?;
    let key = format!("r.{}", char::from(byte));
    (state_file(&key).as_deref() == Some(file)).then_some(key)
}

fn io_failed(_: std::io::Error) -> String {
    STATE_FAILED.into()
}

/// Writes a file whole or not at all: a crash leaves the old version.
fn write_atomically(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let mut temp = path.as_os_str().to_owned();
    temp.push(".tmp");
    let temp = PathBuf::from(temp);
    fs::write(&temp, bytes).map_err(io_failed)?;
    fs::rename(&temp, path).map_err(io_failed)
}

fn load_state(sync: &Path) -> Result<BTreeMap<String, String>, String> {
    let mut state = BTreeMap::new();
    let entries = match fs::read_dir(sync.join("state")) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(state),
        Err(error) => return Err(io_failed(error)),
    };
    for entry in entries {
        let path = entry.map_err(io_failed)?.path();
        let Some(key) = path
            .file_name()
            .and_then(|name| name.to_str())
            .and_then(state_key)
        else {
            continue;
        };
        // A piece that cannot be read is left out: the engine repairs it.
        if let Ok(value) = fs::read_to_string(&path) {
            state.insert(key, value);
        }
    }
    Ok(state)
}

fn save_state(
    sync: &Path,
    set: &BTreeMap<String, String>,
    remove: &[String],
) -> Result<(), String> {
    let mut writes = Vec::with_capacity(set.len());
    for (key, value) in set {
        let file = state_file(key).ok_or(STATE_FAILED)?;
        if value.len() > MAX_STATE_VALUE_BYTES {
            return Err(STATE_FAILED.into());
        }
        writes.push((file, value));
    }
    let removes = remove
        .iter()
        .map(|key| state_file(key).ok_or(STATE_FAILED))
        .collect::<Result<Vec<_>, _>>()?;
    let directory = sync.join("state");
    fs::create_dir_all(&directory).map_err(io_failed)?;
    // The records first and the meta last, as sync-core's key-value store
    // does: a save cut short leaves the cursor where it was.
    let (meta, buckets): (Vec<_>, Vec<_>) = writes
        .into_iter()
        .partition(|(file, _)| file == "meta.json");
    for (file, value) in buckets {
        write_atomically(&directory.join(file), value.as_bytes())?;
    }
    for file in removes {
        match fs::remove_file(directory.join(file)) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(io_failed(error)),
        }
    }
    for (file, value) in meta {
        write_atomically(&directory.join(file), value.as_bytes())?;
    }
    Ok(())
}

fn clear_state(sync: &Path) -> Result<(), String> {
    match fs::remove_dir_all(sync) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(io_failed(error)),
    }
}

/// The engine's saved state: every key and its text.
#[tauri::command]
pub async fn sync_state_load(app: tauri::AppHandle) -> Result<BTreeMap<String, String>, String> {
    let Some(sync) = folder(&app) else {
        return Ok(BTreeMap::new());
    };
    blocking(move || {
        let _files = files_lock();
        load_state(&sync)
    })
    .await
}

/// Saves what changed in the engine's state, in one call per engine save.
#[tauri::command]
pub async fn sync_state_save(
    app: tauri::AppHandle,
    set: BTreeMap<String, String>,
    remove: Vec<String>,
) -> Result<(), String> {
    let sync = require_folder(&app)?;
    blocking(move || {
        let _files = files_lock();
        save_state(&sync, &set, &remove)
    })
    .await
}

/// Forgets the sync state and the deletes waiting for it (sync turned off,
/// or every local data deleted). Local notes stay.
#[tauri::command]
pub async fn sync_state_clear(app: tauri::AppHandle) -> Result<(), String> {
    let Some(sync) = folder(&app) else {
        return Ok(());
    };
    blocking(move || {
        let _files = files_lock();
        clear_state(&sync)
    })
    .await
}

// ── Local stamps and deletes ───────────────────────────────────────────

/// What a local change needs from the engine's saved meta.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct MetaClock {
    device_id: String,
    clock: Hlc,
}

/// Sync is on once the engine has saved its state, until it is forgotten.
pub(super) fn is_on(sync: &Path) -> bool {
    sync.join("state").join("meta.json").is_file()
}

fn read_meta(sync: &Path) -> Option<MetaClock> {
    let text = fs::read_to_string(sync.join("state").join("meta.json")).ok()?;
    let meta: MetaClock = serde_json::from_str(&text).ok()?;
    (is_device_id(&meta.device_id) && meta.clock.is_valid()).then_some(meta)
}

/// The engine's `stamp`: a time later than `previous` (the note's current
/// HLC) and than the latest time the engine saved, with this device's id.
fn next_stamp(meta: &MetaClock, now_ms: u64, previous: Option<&Hlc>) -> Hlc {
    let latest = &meta.clock;
    let t = now_ms.max(latest.t);
    let mut next = Hlc {
        t,
        c: if t == latest.t { latest.c + 1 } else { 0 },
        d: meta.device_id.clone(),
    };
    if let Some(previous) = previous.filter(|previous| previous.is_valid()) {
        if next.order(previous) != Ordering::Greater {
            next = Hlc {
                t: previous.t,
                c: previous.c + 1,
                d: meta.device_id.clone(),
            };
        }
    }
    next
}

pub(super) fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|time| time.as_millis() as u64)
        .unwrap_or_default()
}

/// The HLC to store with a note changed on this device, so the change reaches
/// the other devices and wins over the version it replaces. None while sync
/// is off: the engine then dates the note by its own times when it starts.
pub(super) fn local_stamp(sync: &Path, previous: Option<&Hlc>, now_ms: u64) -> Option<Hlc> {
    read_meta(sync).map(|meta| next_stamp(&meta, now_ms, previous))
}

/// A note the user deleted, kept until the engine has recorded the delete.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct PendingDelete {
    pub id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hlc: Option<Hlc>,
}

fn read_deletes(sync: &Path) -> BTreeMap<String, Option<Hlc>> {
    fs::read(sync.join("deletes.json"))
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default()
}

fn write_deletes(sync: &Path, deletes: &BTreeMap<String, Option<Hlc>>) -> Result<(), String> {
    let path = sync.join("deletes.json");
    if deletes.is_empty() {
        return match fs::remove_file(path) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(io_failed(error)),
        };
    }
    write_atomically(
        &path,
        &serde_json::to_vec(deletes).map_err(|_| STATE_FAILED.to_string())?,
    )
}

/// Records a delete the user made while sync is on, so it reaches the other
/// devices even if the engine is not running now. Retention never calls it.
pub(super) fn record_delete(sync: &Path, id: &str, hlc: Option<Hlc>) -> Result<(), String> {
    let _files = files_lock();
    if !is_on(sync) {
        return Ok(());
    }
    let mut deletes = read_deletes(sync);
    deletes.insert(id.to_owned(), hlc);
    write_deletes(sync, &deletes)
}

fn take_deletes(sync: &Path) -> Vec<PendingDelete> {
    read_deletes(sync)
        .into_iter()
        .map(|(id, hlc)| PendingDelete { id, hlc })
        .collect()
}

/// Forgets the deletes the engine recorded. One made again meanwhile (the
/// note came back through sync and was deleted once more) carries another
/// version and stays.
fn finish_deletes(sync: &Path, done: &[PendingDelete]) -> Result<(), String> {
    let mut deletes = read_deletes(sync);
    for PendingDelete { id, hlc } in done {
        if deletes.get(id) == Some(hlc) {
            deletes.remove(id);
        }
    }
    write_deletes(sync, &deletes)
}

/// Deletes made on this device that the engine has not recorded yet.
#[tauri::command]
pub async fn sync_pending_deletes(app: tauri::AppHandle) -> Result<Vec<PendingDelete>, String> {
    let Some(sync) = folder(&app) else {
        return Ok(vec![]);
    };
    blocking(move || {
        let _files = files_lock();
        Ok(take_deletes(&sync))
    })
    .await
}

/// The engine has recorded these deletes (it keeps them until the server has them).
#[tauri::command]
pub async fn sync_pending_deletes_done(
    app: tauri::AppHandle,
    deletes: Vec<PendingDelete>,
) -> Result<(), String> {
    let Some(sync) = folder(&app) else {
        return Ok(());
    };
    blocking(move || {
        let _files = files_lock();
        finish_deletes(&sync, &deletes)
    })
    .await
}

// ── Requests to the sync server ────────────────────────────────────────

/// Why a request got no answer from the server.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum RequestErrorKind {
    /// The build has no sync server.
    Unavailable,
    /// Not one of the vault requests this module carries.
    Invalid,
    /// The request is over the server's size limit.
    TooLarge,
    /// No answer: offline, DNS, TLS or the timeout.
    Network,
    /// The answer was over the size limit.
    ResponseTooLarge,
}

#[derive(Debug, PartialEq, Serialize)]
pub struct RequestError {
    kind: RequestErrorKind,
    message: &'static str,
}

impl RequestError {
    fn new(kind: RequestErrorKind) -> Self {
        let message = match kind {
            RequestErrorKind::Unavailable => NOT_AVAILABLE,
            RequestErrorKind::Invalid => "Invalid sync request.",
            RequestErrorKind::TooLarge => "The sync request is too large.",
            RequestErrorKind::Network => "The sync server could not be reached.",
            RequestErrorKind::ResponseTooLarge => "The sync server's answer is too large.",
        };
        Self { kind, message }
    }
}

/// The server's answer, whatever its status: the engine reads it.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncResponse {
    status: u16,
    body: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    retry_after: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Route {
    CreateVault,
    Changes,
    Records,
    DeleteVault,
}

fn is_vault_id(id: &str) -> bool {
    id.len() == 22
        && id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

/// The digits of a non-negative safe integer, without a sign or spaces.
fn count(text: &str, max: u64) -> Option<u64> {
    if text.is_empty() || text.len() > 16 || !text.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    text.parse::<u64>().ok().filter(|value| *value <= max)
}

/// The only requests the sync engine makes (sync-core's `SYNC_PATHS`).
fn route(method: &str, path: &str) -> Option<Route> {
    let (path, query) = match path.split_once('?') {
        Some((path, query)) => (path, Some(query)),
        None => (path, None),
    };
    if path == "/v1/vaults" {
        return (method == "POST" && query.is_none()).then_some(Route::CreateVault);
    }
    let rest = path.strip_prefix("/v1/vaults/")?;
    let (vault, action) = match rest.split_once('/') {
        Some((vault, action)) => (vault, Some(action)),
        None => (rest, None),
    };
    if !is_vault_id(vault) {
        return None;
    }
    match (method, action, query) {
        ("DELETE", None, None) => Some(Route::DeleteVault),
        ("POST", Some("records"), None) => Some(Route::Records),
        ("GET", Some("changes"), Some(query)) => {
            let (since, limit) = query.strip_prefix("since=")?.split_once("&limit=")?;
            count(since, MAX_SAFE_INTEGER)?;
            let limit = count(limit, 200)?;
            (limit >= 1).then_some(Route::Changes)
        }
        _ => None,
    }
}

/// Checks a request before anything is sent.
fn check_request(
    method: &str,
    path: &str,
    body: Option<&str>,
    bearer: Option<&str>,
) -> Result<Route, RequestError> {
    let invalid = || RequestError::new(RequestErrorKind::Invalid);
    let route = route(method, path).ok_or_else(invalid)?;
    let wants_body = matches!(route, Route::CreateVault | Route::Records);
    if wants_body != body.is_some() {
        return Err(invalid());
    }
    if body.is_some_and(|body| body.len() > MAX_REQUEST_BYTES) {
        return Err(RequestError::new(RequestErrorKind::TooLarge));
    }
    match (route, bearer) {
        // Creating a vault proves nothing yet: it sends the verifier, never the token.
        (Route::CreateVault, None) => Ok(route),
        (Route::CreateVault, Some(_)) => Err(invalid()),
        (_, Some(token))
            if token.len() == 43
                && token
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_') =>
        {
            Ok(route)
        }
        _ => Err(invalid()),
    }
}

fn http() -> Result<&'static reqwest::blocking::Client, RequestError> {
    static CLIENT: OnceLock<reqwest::blocking::Client> = OnceLock::new();
    if let Some(client) = CLIENT.get() {
        return Ok(client);
    }
    let client = super::online::http_client(REQUEST_TIMEOUT)
        .map_err(|_| RequestError::new(RequestErrorKind::Network))?;
    Ok(CLIENT.get_or_init(|| client))
}

fn send(
    base: &str,
    method: &str,
    path: &str,
    body: Option<String>,
    bearer: Option<&str>,
) -> Result<SyncResponse, RequestError> {
    let client = http()?;
    let url = format!("{base}{path}");
    let mut request = match method {
        "GET" => client.get(url),
        "POST" => client.post(url),
        "DELETE" => client.delete(url),
        _ => return Err(RequestError::new(RequestErrorKind::Invalid)),
    }
    .header(reqwest::header::ACCEPT, "application/json");
    if let Some(token) = bearer {
        request = request.bearer_auth(token);
    }
    if let Some(body) = body {
        request = request
            .header(reqwest::header::CONTENT_TYPE, "application/json")
            .body(body);
    }
    let response = request
        .send()
        .map_err(|_| RequestError::new(RequestErrorKind::Network))?;
    let status = response.status().as_u16();
    let retry_after = response
        .headers()
        .get(reqwest::header::RETRY_AFTER)
        .and_then(|value| value.to_str().ok())
        .map(str::to_owned);
    let mut bytes = vec![];
    response
        .take(MAX_RESPONSE_BYTES as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| RequestError::new(RequestErrorKind::Network))?;
    if bytes.len() > MAX_RESPONSE_BYTES {
        return Err(RequestError::new(RequestErrorKind::ResponseTooLarge));
    }
    Ok(SyncResponse {
        status,
        body: String::from_utf8_lossy(&bytes).into_owned(),
        retry_after,
    })
}

/// Sends one of the sync engine's requests to the build's sync server and
/// returns the answer, whatever its status. `bearer` is the vault's token,
/// sent on every request but the one that creates the vault.
#[tauri::command]
pub async fn sync_request(
    method: String,
    path: String,
    body: Option<String>,
    bearer: Option<String>,
) -> Result<SyncResponse, RequestError> {
    let base = base_url().ok_or_else(|| RequestError::new(RequestErrorKind::Unavailable))?;
    check_request(&method, &path, body.as_deref(), bearer.as_deref())?;
    tauri::async_runtime::spawn_blocking(move || {
        send(&base, &method, &path, body, bearer.as_deref())
    })
    .await
    .map_err(|_| RequestError::new(RequestErrorKind::Network))?
}

#[cfg(test)]
mod tests {
    use super::*;
    use keyring::{mock::MockCredential, Entry};

    const VAULT: &str = "AAAAAAAAAAAAAAAAAAAAAA";
    const TOKEN: &str = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJ0123456";

    #[test]
    fn server_urls_follow_the_https_rule() {
        assert_eq!(
            check_server_url(Some(" https://Sync.Example.com/ "), false),
            Ok("https://sync.example.com".into())
        );
        assert_eq!(
            check_server_url(Some("HTTPS://sync.example.com:8443/base/path//"), false),
            Ok("https://sync.example.com:8443/base/path".into())
        );
        assert_eq!(
            check_server_url(Some("https://[2001:DB8::1]:443"), false),
            Ok("https://[2001:db8::1]:443".into())
        );
        // A release build accepts only https, even to this machine.
        for url in [
            "http://127.0.0.1:8712",
            "http://localhost",
            "http://example.com",
        ] {
            assert_eq!(
                check_server_url(Some(url), false),
                Err(UrlProblem::Insecure)
            );
        }
        // A debug build may use plain http to this machine, and only there.
        assert_eq!(
            check_server_url(Some("http://127.0.0.1:8712"), true),
            Ok("http://127.0.0.1:8712".into())
        );
        assert_eq!(
            check_server_url(Some("http://LOCALHOST:8712/"), true),
            Ok("http://localhost:8712".into())
        );
        for url in ["http://example.com", "http://10.0.0.2", "http://[::1]:8712"] {
            assert_eq!(check_server_url(Some(url), true), Err(UrlProblem::Insecure));
        }
        assert_eq!(check_server_url(None, true), Err(UrlProblem::Missing));
        assert_eq!(check_server_url(Some("  "), true), Err(UrlProblem::Missing));
        for url in [
            "sync.example.com",
            "ftp://sync.example.com",
            "https://user:secret@sync.example.com",
            "https://sync.example.com?token=1",
            "https://sync.example.com/#fragment",
            "https://sync.example.com/a b",
            "https://sync.example.com:0",
            "https://sync.example.com:65536",
            "https://sync.example.com:",
            "https://sync.example.com:12a",
            "https://.example.com",
            "https://example.com.",
            "https://exa..mple.com",
            "https://",
            "https://[]",
            "https://[::1",
        ] {
            assert_eq!(
                check_server_url(Some(url), true),
                Err(UrlProblem::Invalid),
                "{url}"
            );
        }
    }

    #[test]
    fn the_config_names_the_server_or_hides_sync() {
        assert_eq!(
            config_for(Some("https://sync.example.com:8443/base"), false),
            SyncConfig {
                available: true,
                server: Some("sync.example.com:8443".into())
            }
        );
        let hidden = SyncConfig {
            available: false,
            server: None,
        };
        assert_eq!(config_for(None, true), hidden);
        assert_eq!(config_for(Some("http://127.0.0.1:8712"), false), hidden);
        assert_eq!(
            serde_json::to_value(config_for(None, false)).unwrap(),
            serde_json::json!({ "available": false })
        );
    }

    #[test]
    fn only_vault_requests_are_carried() {
        let changes = format!("/v1/vaults/{VAULT}/changes?since=0&limit=200");
        assert_eq!(route("POST", "/v1/vaults"), Some(Route::CreateVault));
        assert_eq!(route("GET", &changes), Some(Route::Changes));
        assert_eq!(
            route(
                "GET",
                &format!("/v1/vaults/{VAULT}/changes?since=9007199254740991&limit=1")
            ),
            Some(Route::Changes)
        );
        assert_eq!(
            route("POST", &format!("/v1/vaults/{VAULT}/records")),
            Some(Route::Records)
        );
        assert_eq!(
            route("DELETE", &format!("/v1/vaults/{VAULT}")),
            Some(Route::DeleteVault)
        );
        for (method, path) in [
            ("GET", "/v1/vaults".to_string()),
            ("DELETE", "/v1/vaults".to_string()),
            ("POST", "/v1/vaults?x=1".to_string()),
            ("POST", "/v1/vaults/".to_string()),
            ("POST", changes.clone()),
            ("PUT", format!("/v1/vaults/{VAULT}/records")),
            ("GET", format!("/v1/vaults/{VAULT}/records")),
            ("POST", format!("/v1/vaults/{VAULT}/records?since=0")),
            ("POST", format!("/v1/vaults/{VAULT}/records/")),
            ("DELETE", format!("/v1/vaults/{VAULT}/")),
            ("DELETE", format!("/v1/vaults/{VAULT}?force=1")),
            ("GET", format!("/v1/vaults/{VAULT}")),
            ("GET", format!("/v1/vaults/{VAULT}/changes")),
            ("GET", format!("/v1/vaults/{VAULT}/changes?since=0")),
            ("GET", format!("/v1/vaults/{VAULT}/changes?limit=1&since=0")),
            ("GET", format!("/v1/vaults/{VAULT}/changes?since=0&limit=0")),
            (
                "GET",
                format!("/v1/vaults/{VAULT}/changes?since=0&limit=201"),
            ),
            (
                "GET",
                format!("/v1/vaults/{VAULT}/changes?since=-1&limit=1"),
            ),
            (
                "GET",
                format!("/v1/vaults/{VAULT}/changes?since=+1&limit=1"),
            ),
            (
                "GET",
                format!("/v1/vaults/{VAULT}/changes?since=1&limit=1&x=2"),
            ),
            (
                "GET",
                format!("/v1/vaults/{VAULT}/changes?since=1%20&limit=1"),
            ),
            (
                "GET",
                format!("/v1/vaults/{VAULT}/changes?since=9007199254740992&limit=1"),
            ),
            (
                "GET",
                format!("/v1/vaults/{VAULT}/changes/x?since=0&limit=1"),
            ),
            ("DELETE", "/v1/vaults/short".to_string()),
            ("DELETE", "/v1/vaults/AAAAAAAAAAAAAAAAAAAAA.".to_string()),
            ("DELETE", "/v1/vaults/../../../../etc/passwd".to_string()),
            (
                "DELETE",
                "/v1/vaults/%2e%2e%2fAAAAAAAAAAAAAAAAA".to_string(),
            ),
            ("POST", "/v1/vaults/../admin".to_string()),
            ("GET", "/v1/admin/status".to_string()),
            ("GET", "/health".to_string()),
            ("POST", "//evil.example/v1/vaults".to_string()),
            ("POST", "https://evil.example/v1/vaults".to_string()),
            ("POST", "@evil.example/v1/vaults".to_string()),
            ("POST", "".to_string()),
        ] {
            assert_eq!(route(method, &path), None, "{method} {path}");
        }
    }

    #[test]
    fn requests_carry_a_body_and_a_token_only_where_due() {
        let records = format!("/v1/vaults/{VAULT}/records");
        let changes = format!("/v1/vaults/{VAULT}/changes?since=0&limit=200");
        let delete = format!("/v1/vaults/{VAULT}");
        let invalid = Err(RequestError::new(RequestErrorKind::Invalid));
        assert_eq!(
            check_request("POST", "/v1/vaults", Some("{}"), None),
            Ok(Route::CreateVault)
        );
        // The token never goes with the request that creates the vault.
        assert_eq!(
            check_request("POST", "/v1/vaults", Some("{}"), Some(TOKEN)),
            invalid
        );
        assert_eq!(check_request("POST", "/v1/vaults", None, None), invalid);
        assert_eq!(
            check_request("POST", &records, Some("{}"), Some(TOKEN)),
            Ok(Route::Records)
        );
        assert_eq!(check_request("POST", &records, Some("{}"), None), invalid);
        assert_eq!(check_request("POST", &records, None, Some(TOKEN)), invalid);
        assert_eq!(
            check_request("GET", &changes, None, Some(TOKEN)),
            Ok(Route::Changes)
        );
        assert_eq!(
            check_request("GET", &changes, Some(""), Some(TOKEN)),
            invalid
        );
        assert_eq!(
            check_request("DELETE", &delete, None, Some(TOKEN)),
            Ok(Route::DeleteVault)
        );
        for token in ["", "short", &TOKEN.replace('a', "+"), &format!("{TOKEN}A")] {
            assert_eq!(check_request("DELETE", &delete, None, Some(token)), invalid);
        }
        let large = "x".repeat(MAX_REQUEST_BYTES + 1);
        assert_eq!(
            check_request("POST", &records, Some(&large), Some(TOKEN)),
            Err(RequestError::new(RequestErrorKind::TooLarge))
        );
        let full = "x".repeat(MAX_REQUEST_BYTES);
        assert_eq!(
            check_request("POST", &records, Some(&full), Some(TOKEN)),
            Ok(Route::Records)
        );
    }

    #[test]
    fn request_errors_reach_the_webview_with_their_kind() {
        assert_eq!(
            serde_json::to_value(RequestError::new(RequestErrorKind::ResponseTooLarge)).unwrap(),
            serde_json::json!({
                "kind": "responseTooLarge",
                "message": "The sync server's answer is too large."
            })
        );
    }

    fn mock_entry() -> Entry {
        Entry::new_with_credential(Box::new(MockCredential::default()))
    }

    fn mock(entry: &Entry) -> &MockCredential {
        entry
            .get_credential()
            .downcast_ref::<MockCredential>()
            .unwrap()
    }

    /// Bytes 0 to 31 as base64url.
    const ROOT: &str = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8";

    #[test]
    fn the_key_lives_in_the_keychain_until_forgotten() {
        let entry = mock_entry();
        assert_eq!(read_root(&entry), Ok(None));
        create_root(&entry, ROOT).unwrap();
        assert_eq!(read_root(&entry), Ok(Some(ROOT.into())));
        // Saving the same key again is harmless; another key is refused.
        create_root(&entry, &format!(" {ROOT}\n")).unwrap();
        let second = "HyAhIiMkJSYnKCkqKywtLi8wMTIzNDU2Nzg5Ojs8PT4";
        assert_eq!(create_root(&entry, second), Err(KEY_EXISTS.into()));
        assert_eq!(read_root(&entry), Ok(Some(ROOT.into())));
        // Joining another vault replaces it.
        import_root(&entry, second).unwrap();
        assert_eq!(read_root(&entry), Ok(Some(second.into())));
        forget_root(&entry).unwrap();
        assert_eq!(read_root(&entry), Ok(None));
        forget_root(&entry).unwrap();
    }

    #[test]
    fn only_32_byte_keys_are_saved() {
        let entry = mock_entry();
        for key in [
            "",
            "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=",
            "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHg",
            "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8gIQ",
            "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh+",
            "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwd Hh",
        ] {
            assert_eq!(create_root(&entry, key), Err(INVALID_KEY.into()), "{key}");
            assert_eq!(import_root(&entry, key), Err(INVALID_KEY.into()), "{key}");
        }
        assert_eq!(read_root(&entry), Ok(None));
        // A damaged entry counts as none, and a new key replaces it.
        entry.set_password("not a key").unwrap();
        assert_eq!(read_root(&entry), Ok(None));
        create_root(&entry, ROOT).unwrap();
        assert_eq!(read_root(&entry), Ok(Some(ROOT.into())));
    }

    #[test]
    fn a_missing_keychain_says_sync_is_unavailable() {
        let entry = mock_entry();
        let no_service = || {
            keyring::Error::PlatformFailure(Box::new(std::io::Error::other(
                "DBus error: The name org.freedesktop.secrets was not provided",
            )))
        };
        mock(&entry).set_error(no_service());
        assert_eq!(read_root(&entry), Err(KEYCHAIN_UNAVAILABLE.into()));
        mock(&entry).set_error(keyring::Error::NoStorageAccess(Box::new(
            std::io::Error::other("locked"),
        )));
        assert_eq!(create_root(&entry, ROOT), Err(KEYCHAIN_UNAVAILABLE.into()));
        mock(&entry).set_error(no_service());
        assert_eq!(forget_root(&entry), Err(KEYCHAIN_UNAVAILABLE.into()));
        mock(&entry).set_error(keyring::Error::TooLong("user".into(), 8));
        assert_eq!(import_root(&entry, ROOT), Err(KEYCHAIN_FAILED.into()));
        assert!(KEYCHAIN_UNAVAILABLE.starts_with("Sync is unavailable on this system"));
        // Once the keychain answers again, the key works as usual.
        import_root(&entry, ROOT).unwrap();
        assert_eq!(read_root(&entry), Ok(Some(ROOT.into())));
    }

    fn map(pairs: &[(&str, &str)]) -> BTreeMap<String, String> {
        pairs
            .iter()
            .map(|(key, value)| ((*key).into(), (*value).into()))
            .collect()
    }

    #[test]
    fn the_state_is_saved_and_loaded_piece_by_piece() {
        let folder = tempfile::tempdir().unwrap();
        let sync = folder.path().join("sync");
        assert_eq!(load_state(&sync), Ok(BTreeMap::new()));
        assert!(!is_on(&sync));
        save_state(
            &sync,
            &map(&[
                ("meta", "{\"v\":1}"),
                ("r.a", "{\"a\":1}"),
                ("r.A", "{\"A\":1}"),
            ]),
            &[],
        )
        .unwrap();
        assert!(is_on(&sync));
        // "r.a" and "r.A" are two files even where file names ignore case.
        assert!(sync.join("state").join("r-61.json").is_file());
        assert!(sync.join("state").join("r-41.json").is_file());
        save_state(
            &sync,
            &map(&[("r._", "{}"), ("r.-", "[]")]),
            &["r.a".into()],
        )
        .unwrap();
        assert_eq!(
            load_state(&sync),
            Ok(map(&[
                ("meta", "{\"v\":1}"),
                ("r.A", "{\"A\":1}"),
                ("r._", "{}"),
                ("r.-", "[]")
            ]))
        );
        // Unknown files and leftovers of an interrupted write are ignored.
        fs::write(sync.join("state").join("r-41.json.tmp"), "half").unwrap();
        fs::write(sync.join("state").join("notes.txt"), "x").unwrap();
        fs::write(sync.join("state").join("r-2e.json"), "x").unwrap();
        assert_eq!(load_state(&sync).unwrap().len(), 4);
        // Removing what is not there is fine.
        save_state(&sync, &BTreeMap::new(), &["r.z".into()]).unwrap();
        clear_state(&sync).unwrap();
        assert!(!sync.exists());
        assert!(!is_on(&sync));
        clear_state(&sync).unwrap();
    }

    #[test]
    fn state_keys_cannot_reach_other_files() {
        let folder = tempfile::tempdir().unwrap();
        let sync = folder.path().join("sync");
        for key in [
            "",
            "meta.json",
            "../meta",
            "r.",
            "r.ab",
            "r./",
            "r..",
            "r.é",
            "x.a",
            "metas",
        ] {
            assert_eq!(
                save_state(&sync, &map(&[(key, "x")]), &[]),
                Err(STATE_FAILED.into()),
                "{key}"
            );
            assert_eq!(
                save_state(&sync, &BTreeMap::new(), &[key.into()]),
                Err(STATE_FAILED.into()),
                "{key}"
            );
        }
        // A refused key leaves the whole save undone.
        assert_eq!(
            save_state(&sync, &map(&[("meta", "x"), ("r.ab", "y")]), &[]),
            Err(STATE_FAILED.into())
        );
        assert!(!sync.exists());
        for file in ["r-41.json", "r-5f.json", "r-2d.json", "meta.json"] {
            assert_eq!(state_file(&state_key(file).unwrap()).as_deref(), Some(file));
        }
        for file in [
            "r-2e.json",
            "r-zz.json",
            "r-141.json",
            "r-41.json.tmp",
            "R-41.json",
        ] {
            assert_eq!(state_key(file), None, "{file}");
        }
    }

    fn meta(sync: &Path, device: &str, t: u64, c: u64) {
        let meta = serde_json::json!({
            "v": 1,
            "vaultId": VAULT,
            "deviceId": device,
            "clock": { "t": t, "c": c, "d": device },
            "cursor": 0,
        });
        save_state(sync, &map(&[("meta", &meta.to_string())]), &[]).unwrap();
    }

    fn hlc(t: u64, c: u64, d: &str) -> Hlc {
        Hlc { t, c, d: d.into() }
    }

    #[test]
    fn local_changes_are_stamped_like_the_engine_does() {
        let folder = tempfile::tempdir().unwrap();
        let sync = folder.path().join("sync");
        // Sync off: no stamp.
        assert_eq!(local_stamp(&sync, None, 1_000), None);
        meta(&sync, "device-A", 500, 3);
        // The wall clock is ahead of everything: its time, counter 0.
        assert_eq!(
            local_stamp(&sync, None, 1_000),
            Some(hlc(1_000, 0, "device-A"))
        );
        // The saved clock is ahead of the wall clock: it moves on from there.
        assert_eq!(local_stamp(&sync, None, 400), Some(hlc(500, 4, "device-A")));
        // Later than the note's own version, even one stamped ahead elsewhere.
        assert_eq!(
            local_stamp(&sync, Some(&hlc(5_000, 7, "phone")), 1_000),
            Some(hlc(5_000, 8, "device-A"))
        );
        assert_eq!(
            local_stamp(&sync, Some(&hlc(1_000, 0, "zzz")), 1_000),
            Some(hlc(1_000, 1, "device-A"))
        );
        assert_eq!(
            local_stamp(&sync, Some(&hlc(1_000, 0, "aaa")), 1_000),
            Some(hlc(1_000, 0, "device-A"))
        );
        // A damaged meta is no meta.
        save_state(&sync, &map(&[("meta", "{\"deviceId\":\"../x\"}")]), &[]).unwrap();
        assert_eq!(local_stamp(&sync, None, 1_000), None);
    }

    #[test]
    fn hlc_values_follow_the_engine_rules() {
        assert!(hlc(0, 0, "a").is_valid());
        assert!(hlc(MAX_SAFE_INTEGER, MAX_SAFE_INTEGER, &"x".repeat(64)).is_valid());
        assert!(!hlc(MAX_SAFE_INTEGER + 1, 0, "a").is_valid());
        assert!(!hlc(0, 0, "").is_valid());
        assert!(!hlc(0, 0, &"x".repeat(65)).is_valid());
        assert!(!hlc(0, 0, "a/b").is_valid());
        assert_eq!(hlc(1, 2, "B").order(&hlc(1, 2, "a")), Ordering::Less);
        assert_eq!(hlc(2, 0, "a").order(&hlc(1, 9, "z")), Ordering::Greater);
        assert_eq!(hlc(1, 2, "a").order(&hlc(1, 2, "a")), Ordering::Equal);
    }

    #[test]
    fn deletes_wait_for_the_engine_only_while_sync_is_on() {
        let folder = tempfile::tempdir().unwrap();
        let sync = folder.path().join("sync");
        record_delete(&sync, "1-1", None).unwrap();
        assert_eq!(take_deletes(&sync), vec![]);
        meta(&sync, "device-A", 0, 0);
        record_delete(&sync, "1-1", None).unwrap();
        record_delete(&sync, "turn_2_abc", Some(hlc(5, 1, "phone"))).unwrap();
        assert_eq!(
            take_deletes(&sync),
            vec![
                PendingDelete {
                    id: "1-1".into(),
                    hlc: None
                },
                PendingDelete {
                    id: "turn_2_abc".into(),
                    hlc: Some(hlc(5, 1, "phone"))
                },
            ]
        );
        let done = |id: &str, hlc: Option<Hlc>| PendingDelete { id: id.into(), hlc };
        finish_deletes(&sync, &[done("1-1", None), done("unknown", None)]).unwrap();
        assert_eq!(take_deletes(&sync).len(), 1);
        // Deleted again since the engine took it: that delete still waits.
        record_delete(&sync, "turn_2_abc", Some(hlc(9, 0, "device-A"))).unwrap();
        finish_deletes(&sync, &[done("turn_2_abc", Some(hlc(5, 1, "phone")))]).unwrap();
        assert_eq!(take_deletes(&sync).len(), 1);
        finish_deletes(&sync, &[done("turn_2_abc", Some(hlc(9, 0, "device-A")))]).unwrap();
        assert!(!sync.join("deletes.json").exists());
        // Turning sync off forgets them with the rest of the state.
        record_delete(&sync, "3-1", None).unwrap();
        clear_state(&sync).unwrap();
        assert_eq!(take_deletes(&sync), vec![]);
    }
}
