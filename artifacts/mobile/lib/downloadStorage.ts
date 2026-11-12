import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';

const key = (lessonId: string) => `download:${lessonId}`;

/**
 * H-10 (2026-11-10): remove every downloaded lesson and its index entries.
 * Called on logout, so the next account on this device cannot play another
 * account's paid downloads. The learn screen also refuses to play anything,
 * local or remote, for courses the current account cannot access.
 * Only this app's own `videos/` folder inside its sandboxed document directory is affected.
 */
export async function clearAllDownloads(): Promise<void> {
  try {
    const keys = await AsyncStorage.getAllKeys();
    const indexKeys = keys.filter((k) => k.startsWith('download:'));
    if (indexKeys.length) await AsyncStorage.multiRemove(indexKeys);
  } catch (e) {
    console.warn('[DownloadStorage] Could not clear download index:', e);
  }
  const docDir = FileSystem.documentDirectory;
  if (!docDir) return;
  try {
    await FileSystem.deleteAsync(docDir + 'videos/', { idempotent: true });
  } catch (e) {
    console.warn('[DownloadStorage] Could not remove downloaded videos:', e);
  }
}

export async function getDownloadedPath(lessonId: string): Promise<string | null> {
  try {
    const path = await AsyncStorage.getItem(key(lessonId));
    if (path) {
      const info = await FileSystem.getInfoAsync(path);
      if (info.exists && !info.isDirectory && (info.size ?? 0) > 0) {
        return path;
      } else {
        // File no longer exists or is empty; clean up stale reference
        await AsyncStorage.removeItem(key(lessonId));
        return null;
      }
    }
  } catch (e) {
    console.warn('[DownloadStorage] Error checking local path:', e);
  }
  return null;
}

export async function setDownloadedPath(lessonId: string, path: string): Promise<void> {
  await AsyncStorage.setItem(key(lessonId), path);
}

export async function removeDownloadedPath(lessonId: string): Promise<void> {
  try {
    const path = await AsyncStorage.getItem(key(lessonId));
    if (path) {
      await FileSystem.deleteAsync(path, { idempotent: true }).catch(() => {});
    }
    await AsyncStorage.removeItem(key(lessonId));
  } catch (e) {
    console.warn('[DownloadStorage] Delete error:', e);
  }
}

export async function downloadLessonVideo(
  lessonId: string,
  videoUrl: string,
  onProgress?: (progressPct: number) => void
): Promise<string> {
  if (!videoUrl || !videoUrl.startsWith('http')) {
    throw new Error('Invalid or non-HTTP video URL');
  }

  // 1. Storage Full Protection: Check available disk space (require min 100MB free buffer)
  try {
    const freeBytes = await FileSystem.getFreeDiskStorageAsync();
    const MIN_REQUIRED_BYTES = 100 * 1024 * 1024; // 100 MB
    if (freeBytes < MIN_REQUIRED_BYTES) {
      throw new Error("Not enough storage to download this video. Free up space and try again.");
    }
  } catch (storageErr: any) {
    if (storageErr.message?.includes("Not enough storage")) {
      throw storageErr;
    }
    // Fall back gracefully if OS disk space query fails
    console.warn('[DownloadStorage] Could not query free disk space:', storageErr);
  }

  const dir = `${FileSystem.documentDirectory}videos/`;
  const dirInfo = await FileSystem.getInfoAsync(dir);
  if (!dirInfo.exists) {
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  }

  // Extract the extension from the S3 object pathname, not the hostname.
  let ext = 'mp4';
  try {
    const pathname = new URL(videoUrl).pathname;
    const filename = decodeURIComponent(pathname.split('/').pop() || '');
    const match = filename.match(/\.([a-zA-Z0-9]{2,5})$/);
    if (match) ext = match[1].toLowerCase();
  } catch {
    console.warn('[DownloadStorage] Could not determine video extension; using mp4');
  }
  const targetPath = `${dir}lesson_${lessonId}.${ext}`;
  const tempPath = `${dir}lesson_${lessonId}_tmp.${ext}`;

  const downloadResumable = FileSystem.createDownloadResumable(
    videoUrl,
    tempPath,
    {},
    (downloadProgress) => {
      if (downloadProgress.totalBytesExpectedToWrite > 0) {
        const pct = Math.round(
          (downloadProgress.totalBytesWritten / downloadProgress.totalBytesExpectedToWrite) * 100
        );
        if (onProgress) onProgress(pct);
      }
    }
  );

  try {
    const result = await downloadResumable.downloadAsync();

    if (!result || !result.uri) {
      throw new Error('Download completed without valid URI');
    }

    console.log('[DownloadStorage] Server response:', {
      status: result.status,
      mimeType: result.mimeType,
      contentType:
        result.headers['content-type'] ??
        result.headers['Content-Type'] ??
        null,
    });

    if (result.status < 200 || result.status >= 300) {
      throw new Error(`Video download failed with HTTP status ${result.status}`);
    }

    const contentType = (
      result.mimeType ||
      result.headers['content-type'] ||
      result.headers['Content-Type'] ||
      ''
    ).toLowerCase();

    if (
      contentType &&
      !contentType.startsWith('video/') &&
      !contentType.includes('octet-stream') &&
      !contentType.includes('application/mp4')
    ) {
      throw new Error(`Server returned an unexpected video content type: ${contentType}`);
    }

    // Replace existing target if present
    const existing = await FileSystem.getInfoAsync(targetPath);
    if (existing.exists) {
      await FileSystem.deleteAsync(targetPath, { idempotent: true });
    }

    await FileSystem.moveAsync({ from: tempPath, to: targetPath });
    // Verify the final file before marking the lesson as downloaded.
    const finalInfo = await FileSystem.getInfoAsync(targetPath);
    if (!finalInfo.exists || finalInfo.isDirectory || (finalInfo.size ?? 0) <= 0) {
      throw new Error('Downloaded video file is missing or empty.');
    }

    console.log('[DownloadStorage] Verified offline video:', {
      extension: ext,
      sizeBytes: finalInfo.size,
    });

    await setDownloadedPath(lessonId, targetPath);
    return targetPath;
  } catch (err) {
    // 2. Partial File Cleanup: Delete .tmp file on error/interruption & confirm cleanup
    await FileSystem.deleteAsync(tempPath, { idempotent: true }).catch(() => {});
    console.log('[DownloadStorage] Cleaned up partial download temp file:', tempPath);
    throw err;
  }
}
