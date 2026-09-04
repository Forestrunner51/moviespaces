import { File } from "expo-file-system";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import { supabase } from "@/frontend/config/supabase";

// Downscales the picked image so a 12-megapixel camera photo isn't shipped
// to Storage (and then to every viewer) at full size. Avatars render at
// ≤128pt; Space covers at screen width. Longest side is capped, aspect kept.
// Returns the original URI if the resize fails — a slightly large upload
// beats a failed save.
async function downscale(uri: string, maxSide: number): Promise<string> {
  try {
    const context = ImageManipulator.manipulate(uri);
    const ref = await context.renderAsync();
    const { width, height } = ref;
    if (width > maxSide || height > maxSide) {
      const scale = maxSide / Math.max(width, height);
      const resized = await context
        .resize({ width: Math.round(width * scale), height: Math.round(height * scale) })
        .renderAsync();
      const saved = await resized.saveAsync({ format: SaveFormat.JPEG, compress: 0.85 });
      return saved.uri;
    }
    // Re-encode anyway so the upload is always a JPEG (the content type we
    // send) even when the picker handed back a PNG/HEIC.
    const saved = await ref.saveAsync({ format: SaveFormat.JPEG, compress: 0.85 });
    return saved.uri;
  } catch (err) {
    console.warn("Image downscale failed; uploading original:", err);
    return uri;
  }
}

// Reads a local image URI into a real ArrayBuffer for Supabase Storage.
//
// NOT fetch(uri).blob() — React Native's Blob cannot be constructed from an
// ArrayBuffer/ArrayBufferView (it throws "Creating blobs from 'ArrayBuffer'
// and 'ArrayBufferView' are not supported"), which is exactly what
// supabase-js's upload path does internally. That failure aborted the whole
// surrounding save, which is how a broken avatar upload silently took the
// user's display name and theater memberships down with it.
//
// Also not FileSystem.readAsStringAsync — that's the pre-SDK-54 legacy API and
// throws at runtime in SDK 56. expo-file-system's File class reads straight
// into an ArrayBuffer with no Blob involved.
//
// expo-image-picker copies the chosen asset into the app's cache and hands
// back a file:// URI on both platforms, which is what File expects. The guard
// below exists so that if a picker ever returns a content:// or ph:// URI
// instead, it surfaces as a clear message rather than an opaque native error.
async function readAsArrayBuffer(uri: string): Promise<ArrayBuffer> {
  try {
    return await new File(uri).arrayBuffer();
  } catch (err: any) {
    throw new Error(
      `Couldn't read the selected image (${err?.message || "unknown error"}). Please pick it again.`,
    );
  }
}

// Uploads a picked image and returns its public URL.
// `maxSide` caps the longest edge (default 1600px, cover photos); avatars pass 512.
// `upsert` is for fixed-path objects (an avatar is always "<userId>.jpg");
// leave it off for append-only paths like Space cover photos.
export async function uploadImage(
  bucket: string,
  path: string,
  localUri: string,
  options: { upsert?: boolean; maxSide?: number } = {},
): Promise<string> {
  const uri = await downscale(localUri, options.maxSide ?? 1600);
  const arrayBuffer = await readAsArrayBuffer(uri);

  const { error: uploadError } = await supabase.storage
    .from(bucket)
    .upload(path, arrayBuffer, {
      contentType: "image/jpeg",
      upsert: options.upsert ?? false,
      // A year: replacements always change the URL (avatars append ?t=, space
      // photos get new filenames), so long TTLs are pure egress savings — the
      // default 1h had every device re-downloading every face hourly.
      cacheControl: "31536000",
    });
  if (uploadError) throw uploadError;

  const { data } = supabase.storage.from(bucket).getPublicUrl(path);
  return data.publicUrl;
}
