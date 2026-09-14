#[cfg(windows)]
pub fn mark_file_sparse(f: &std::fs::File) -> bool {
    use std::os::windows::io::AsRawHandle;
    use windows::{
        Win32::Foundation::HANDLE, Win32::System::IO::DeviceIoControl,
        Win32::System::Ioctl::FSCTL_SET_SPARSE,
    };

    let handle = HANDLE(f.as_raw_handle());

    unsafe { DeviceIoControl(handle, FSCTL_SET_SPARSE, None, 0, None, 0, None, None).is_ok() }
}

/// ventic: give the whole filesystem blocks inside `offset..offset + len` back to the disk,
/// leaving the file's length alone. Rounded inward to the block, so no byte outside the
/// range is ever touched — a piece that is kept can share a block with one that isn't.
/// A punched range reads back as zeros, which is why the piece is forgotten first.
pub fn punch_hole(f: &std::fs::File, offset: u64, len: u64) -> anyhow::Result<()> {
    const BLOCK: u64 = 4096;
    let start = offset.div_ceil(BLOCK) * BLOCK;
    let end = (offset + len) / BLOCK * BLOCK;
    if end <= start {
        return Ok(());
    }
    punch(f, start, end - start)
}

#[cfg(any(target_os = "linux", target_os = "android"))]
fn punch(f: &std::fs::File, offset: u64, len: u64) -> anyhow::Result<()> {
    use std::os::fd::AsRawFd;
    // The 64 variant because `off_t` is 32 bits on armv7 Android — a TV box — and a film is
    // past 2 GiB by its second act.
    let done = unsafe {
        libc::fallocate64(
            f.as_raw_fd(),
            libc::FALLOC_FL_PUNCH_HOLE | libc::FALLOC_FL_KEEP_SIZE,
            offset as libc::off64_t,
            len as libc::off64_t,
        )
    };
    if done != 0 {
        anyhow::bail!(std::io::Error::last_os_error());
    }
    Ok(())
}

#[cfg(target_os = "macos")]
fn punch(f: &std::fs::File, offset: u64, len: u64) -> anyhow::Result<()> {
    use std::os::fd::AsRawFd;
    let hole = libc::fpunchhole_t {
        fp_flags: 0,
        reserved: 0,
        fp_offset: offset as libc::off_t,
        fp_length: len as libc::off_t,
    };
    if unsafe { libc::fcntl(f.as_raw_fd(), libc::F_PUNCHHOLE, &hole) } != 0 {
        anyhow::bail!(std::io::Error::last_os_error());
    }
    Ok(())
}

#[cfg(windows)]
fn punch(f: &std::fs::File, offset: u64, len: u64) -> anyhow::Result<()> {
    use std::os::windows::io::AsRawHandle;
    use windows::{
        Win32::Foundation::HANDLE,
        Win32::System::IO::DeviceIoControl,
        Win32::System::Ioctl::{FILE_ZERO_DATA_INFORMATION, FSCTL_SET_ZERO_DATA},
    };
    // Deallocates only in a sparse file, which this one became on its first write
    // (`try_mark_sparse`). In any other it writes zeros, which is still correct.
    let zero = FILE_ZERO_DATA_INFORMATION {
        FileOffset: offset as i64,
        BeyondFinalZero: (offset + len) as i64,
    };
    unsafe {
        DeviceIoControl(
            HANDLE(f.as_raw_handle()),
            FSCTL_SET_ZERO_DATA,
            Some(std::ptr::from_ref(&zero).cast()),
            size_of::<FILE_ZERO_DATA_INFORMATION>() as u32,
            None,
            0,
            None,
            None,
        )
    }?;
    Ok(())
}

#[cfg(not(any(target_os = "linux", target_os = "android", target_os = "macos", windows)))]
fn punch(_f: &std::fs::File, _offset: u64, _len: u64) -> anyhow::Result<()> {
    Ok(())
}
