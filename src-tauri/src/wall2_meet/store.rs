//! Refresh-token storage. Production uses Windows Credential Manager (DPAPI protected, per
//! user); tests use a memory map. A generic credential holds at most 2560 bytes and a refresh
//! token can come close, so a value is split into chunks `/0`, `/1`, and so on.

use std::cell::RefCell;
use std::collections::HashMap;

/// `CRED_MAX_CREDENTIAL_BLOB_SIZE`.
pub const CHUNK: usize = 2560;
pub const MAX_CHUNKS: usize = 4;

/// One raw blob per target name.
pub trait BlobStore {
    fn read(&self, target: &str) -> Option<Vec<u8>>;
    fn write(&self, target: &str, data: &[u8]) -> bool;
    fn remove(&self, target: &str);
}

/// One secret string per account id.
pub trait SecretStore {
    fn get(&self, id: &str) -> Option<String>;
    fn set(&self, id: &str, value: &str) -> bool;
    fn delete(&self, id: &str);
}

pub fn target(id: &str, n: usize) -> String {
    format!("WidgetWall2/meet/{id}/{n}")
}

pub struct Chunked<B: BlobStore>(pub B);

impl<B: BlobStore> SecretStore for Chunked<B> {
    fn get(&self, id: &str) -> Option<String> {
        let mut out: Vec<u8> = Vec::new();
        let mut found = false;
        for n in 0..MAX_CHUNKS {
            match self.0.read(&target(id, n)) {
                Some(part) => {
                    found = true;
                    out.extend_from_slice(&part);
                }
                None => break,
            }
        }
        if !found {
            return None;
        }
        String::from_utf8(out).ok()
    }

    fn set(&self, id: &str, value: &str) -> bool {
        let bytes = value.as_bytes();
        if bytes.len() > CHUNK * MAX_CHUNKS {
            return false;
        }
        let pieces: Vec<&[u8]> = if bytes.is_empty() { vec![&bytes[..0]] } else { bytes.chunks(CHUNK).collect() };
        // Remember the old value: a failed write must leave it as it was, not wipe it.
        let previous: Vec<Option<Vec<u8>>> = (0..MAX_CHUNKS).map(|n| self.0.read(&target(id, n))).collect();
        for (n, piece) in pieces.iter().enumerate() {
            if !self.0.write(&target(id, n), piece) {
                for (m, old) in previous.iter().enumerate() {
                    match old {
                        Some(b) => {
                            self.0.write(&target(id, m), b);
                        }
                        None => self.0.remove(&target(id, m)),
                    }
                }
                return false;
            }
        }
        for n in pieces.len()..MAX_CHUNKS {
            self.0.remove(&target(id, n));
        }
        true
    }

    fn delete(&self, id: &str) {
        for n in 0..MAX_CHUNKS {
            self.0.remove(&target(id, n));
        }
    }
}

/// Test store.
#[derive(Default)]
pub struct MemoryBlobs {
    map: RefCell<HashMap<String, Vec<u8>>>,
}

impl MemoryBlobs {
    pub fn len(&self) -> usize {
        self.map.borrow().len()
    }
}

impl BlobStore for MemoryBlobs {
    fn read(&self, target: &str) -> Option<Vec<u8>> {
        self.map.borrow().get(target).cloned()
    }
    fn write(&self, target: &str, data: &[u8]) -> bool {
        self.map.borrow_mut().insert(target.to_string(), data.to_vec());
        true
    }
    fn remove(&self, target: &str) {
        self.map.borrow_mut().remove(target);
    }
}

/// Windows Credential Manager: generic credentials, persisted for this machine and user.
pub struct CredBlobs;

fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

impl BlobStore for CredBlobs {
    fn read(&self, target: &str) -> Option<Vec<u8>> {
        use windows::core::PCWSTR;
        use windows::Win32::Security::Credentials::{CredFree, CredReadW, CREDENTIALW, CRED_TYPE_GENERIC};
        let name = wide(target);
        let mut cred: *mut CREDENTIALW = std::ptr::null_mut();
        unsafe {
            if CredReadW(PCWSTR(name.as_ptr()), CRED_TYPE_GENERIC, 0, &mut cred).is_err() || cred.is_null() {
                return None;
            }
            let c = &*cred;
            let data = if c.CredentialBlob.is_null() || c.CredentialBlobSize == 0 {
                Vec::new()
            } else {
                std::slice::from_raw_parts(c.CredentialBlob, c.CredentialBlobSize as usize).to_vec()
            };
            CredFree(cred as *const std::ffi::c_void);
            Some(data)
        }
    }

    fn write(&self, target: &str, data: &[u8]) -> bool {
        use windows::core::PWSTR;
        use windows::Win32::Security::Credentials::{
            CredWriteW, CREDENTIALW, CRED_FLAGS, CRED_PERSIST_LOCAL_MACHINE, CRED_TYPE_GENERIC,
        };
        if data.len() > CHUNK {
            return false;
        }
        let mut name = wide(target);
        let mut user = wide("wall2");
        unsafe {
            let mut cred: CREDENTIALW = std::mem::zeroed();
            cred.Flags = CRED_FLAGS(0);
            cred.Type = CRED_TYPE_GENERIC;
            cred.TargetName = PWSTR(name.as_mut_ptr());
            cred.CredentialBlobSize = data.len() as u32;
            cred.CredentialBlob = data.as_ptr() as *mut u8;
            cred.Persist = CRED_PERSIST_LOCAL_MACHINE;
            cred.UserName = PWSTR(user.as_mut_ptr());
            CredWriteW(&cred, 0).is_ok()
        }
    }

    fn remove(&self, target: &str) {
        use windows::core::PCWSTR;
        use windows::Win32::Security::Credentials::{CredDeleteW, CRED_TYPE_GENERIC};
        let name = wide(target);
        unsafe {
            let _ = CredDeleteW(PCWSTR(name.as_ptr()), CRED_TYPE_GENERIC, 0);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn value(len: usize) -> String {
        (0..len).map(|i| (b'a' + (i % 26) as u8) as char).collect()
    }

    #[test]
    fn round_trips_across_chunk_boundaries() {
        for len in [0usize, 1, 2560, 2561, 6000] {
            let s = Chunked(MemoryBlobs::default());
            let v = value(len);
            assert!(s.set("work", &v), "set {len}");
            assert_eq!(s.get("work"), Some(v), "get {len}");
        }
    }

    #[test]
    fn chunk_counts() {
        let s = Chunked(MemoryBlobs::default());
        s.set("a", &value(2560));
        assert_eq!(s.0.len(), 1);
        s.set("a", &value(2561));
        assert_eq!(s.0.len(), 2);
        s.set("a", &value(6000));
        assert_eq!(s.0.len(), 3);
    }

    #[test]
    fn too_large_is_refused() {
        let s = Chunked(MemoryBlobs::default());
        assert!(!s.set("a", &value(CHUNK * MAX_CHUNKS + 1)));
        assert_eq!(s.get("a"), None);
    }

    #[test]
    fn overwrite_with_fewer_chunks_leaves_no_stale_chunk() {
        let s = Chunked(MemoryBlobs::default());
        s.set("a", &value(6000));
        s.set("a", "short");
        assert_eq!(s.get("a"), Some("short".to_string()));
        assert_eq!(s.0.len(), 1);
        assert!(s.0.read(&target("a", 1)).is_none());
        assert!(s.0.read(&target("a", 2)).is_none());
    }

    #[test]
    fn delete_removes_everything_and_keeps_other_accounts() {
        let s = Chunked(MemoryBlobs::default());
        s.set("a", &value(6000));
        s.set("b", "other");
        s.delete("a");
        assert_eq!(s.get("a"), None);
        assert_eq!(s.get("b"), Some("other".to_string()));
        assert_eq!(s.0.len(), 1);
    }

    /// Fails exactly the write whose running number equals `fail_from` (0 means never).
    struct FlakyBlobs {
        inner: MemoryBlobs,
        fail_from: std::cell::Cell<usize>,
        writes: std::cell::Cell<usize>,
    }
    impl BlobStore for FlakyBlobs {
        fn read(&self, t: &str) -> Option<Vec<u8>> {
            self.inner.read(t)
        }
        fn write(&self, t: &str, d: &[u8]) -> bool {
            self.writes.set(self.writes.get() + 1);
            if self.fail_from.get() != 0 && self.writes.get() == self.fail_from.get() {
                return false;
            }
            self.inner.write(t, d)
        }
        fn remove(&self, t: &str) {
            self.inner.remove(t)
        }
    }

    #[test]
    fn a_failed_write_keeps_the_previous_value() {
        let s = Chunked(FlakyBlobs { inner: MemoryBlobs::default(), fail_from: Default::default(), writes: Default::default() });
        assert!(s.set("a", &value(5000)));
        // The next set writes three chunks; fail on its second write.
        s.0.fail_from.set(s.0.writes.get() + 2);
        assert!(!s.set("a", &value(6000)));
        assert_eq!(s.get("a"), Some(value(5000)));
        // A failure on the very first write also keeps it.
        s.0.fail_from.set(s.0.writes.get() + 1);
        assert!(!s.set("a", "other"));
        assert_eq!(s.get("a"), Some(value(5000)));
        // A key that never existed is left empty.
        s.0.fail_from.set(s.0.writes.get() + 2);
        assert!(!s.set("b", &value(6000)));
        assert_eq!(s.get("b"), None);
    }

    #[test]
    fn target_names() {
        assert_eq!(target("work", 0), "WidgetWall2/meet/work/0");
    }
}
