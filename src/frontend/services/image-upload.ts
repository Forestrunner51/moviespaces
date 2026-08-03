import { File } from "expo-file-system";
import { supabase } from "@/frontend/config/supabase";

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
// `upsert` is for fixed-path objects (an avatar is always "<userId>.jpg");
// leave it off for append-only paths like Space cover photos.
export async function uploadImage(
  bucket: string,
  path: string,
  localUri: string,
  options: { upsert?: boolean } = {},
): Promise<string> {
  const arrayBuffer = await readAsArrayBuffer(localUri);

  const { error: uploadError } = await supabase.storage
    .from(bucket)
    .upload(path, arrayBuffer, { contentType: "image/jpeg", upsert: options.upsert ?? false });
  if (uploadError) throw uploadError;

  const { data } = supabase.storage.from(bucket).getPublicUrl(path);
  return data.publicUrl;
}
