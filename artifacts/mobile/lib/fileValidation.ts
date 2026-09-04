import * as FileSystem from "expo-file-system/legacy";
import { apiClient } from "@/lib/auth/apiClient";

const MAX_AVATAR_BYTES = 5 * 1024 * 1024; // 5MB
const ALLOWED_MIME = ["image/jpeg", "image/jpg", "image/png", "image/gif", "image/webp"];
const ALLOWED_EXT  = ["jpg", "jpeg", "png", "gif", "webp"];

/**
 * Validates an image picked from the device.
 * Uses picker-supplied metadata (mimeType + fileSize) instead of reading
 * raw bytes — the old atob() / positional-read approach threw on Android
 * content:// URIs in SDK 54, causing the "Failed to parse" error.
 */
export async function validateImageFile(
  uri: string,
  mimeType?: string | null,
  fileSize?: number | null
): Promise<{ valid: boolean; error?: string }> {
  try {
    if (!uri) return { valid: false, error: "No image was selected." };

    // ── Size check ──────────────────────────────────────────────────────
    let size = typeof fileSize === "number" && fileSize > 0 ? fileSize : 0;
    if (!size) {
      try {
        const info = await FileSystem.getInfoAsync(uri);
        if (!info.exists) return { valid: false, error: "Selected file could not be found." };
        size = (info as any).size ?? 0;
      } catch { size = 0; }
    }
    if (size > MAX_AVATAR_BYTES) {
      const mb = (size / (1024 * 1024)).toFixed(1);
      return { valid: false, error: `Image is ${mb}MB. Please choose an image under 5MB.` };
    }

    // ── Type check (mime first, then extension) ─────────────────────────
    if (mimeType) {
      const mt = mimeType.toLowerCase();
      if (!ALLOWED_MIME.includes(mt))
        return { valid: false, error: "Only JPEG, PNG, GIF and WEBP images are supported." };
      return { valid: true };
    }

    const ext = uri.split("?")[0].split("#")[0].split(".").pop()?.toLowerCase() ?? "";
    if (!ext || ext.length > 5) return { valid: true }; // content:// URI, allow it
    if (!ALLOWED_EXT.includes(ext))
      return { valid: false, error: "Only JPEG, PNG, GIF and WEBP images are supported." };

    return { valid: true };
  } catch (err: any) {
    console.error("[validateImageFile] Unexpected error:", err?.message ?? err);
    // Fail open — picker already guarantees an image
    return { valid: true };
  }
}

/**
 * Uploads an avatar image to NestJS Backend Storage (/storage/upload-url).
 * Uses ArrayBuffer for reliable binary transfer to presigned S3 PUT URL.
 */
export async function uploadAvatarFile(
  uriOrUserId: string,
  maybeUri?: string
): Promise<{ success: boolean; publicUrl?: string; error?: string }> {
  const uri = maybeUri || uriOrUserId;
  try {
    const response = await fetch(uri);
    const arrayBuffer = await response.arrayBuffer();
    if (!arrayBuffer || arrayBuffer.byteLength === 0)
      return { success: false, error: "Could not read the selected image." };

    if (arrayBuffer.byteLength > MAX_AVATAR_BYTES) {
      return { success: false, error: "Image exceeds the maximum allowed size of 5MB." };
    }

    const ext = uri.split("?")[0].split("#")[0].split(".").pop()?.toLowerCase() ?? "jpg";
    const contentType = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
    const fileName = `avatar.${ext === "png" || ext === "webp" ? ext : "jpg"}`;

    // 1. Request presigned upload URL from backend storage API
    const presignedData = await apiClient.post<{
      uploadUrl: string;
      key: string;
      publicUrl: string;
    }>('/storage/upload-url', {
      fileName,
      contentType,
      folder: 'avatars',
    });

    if (!presignedData?.uploadUrl || !presignedData?.publicUrl) {
      return { success: false, error: "Failed to get upload authorization." };
    }

    // 2. Upload file binary directly to S3 via presigned PUT URL
    const uploadRes = await fetch(presignedData.uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': contentType,
      },
      body: arrayBuffer,
    });

    if (!uploadRes.ok) {
      return { success: false, error: `Upload failed with status ${uploadRes.status}.` };
    }

    return { success: true, publicUrl: presignedData.publicUrl };
  } catch (e: any) {
    return { success: false, error: e?.message || "Failed to upload the image. Please try again." };
  }
}
