"use client";

import { createBrowserClient } from "@supabase/ssr";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "./config";

export function createClient() {
  return createBrowserClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}

/**
 * Upload a file to the public `naijamart` bucket and return its public URL.
 *
 * The extension is derived from the MIME type, not the file name. A phone
 * camera roll can hand over `image` with no extension at all, and a file
 * named `.jpg` can actually be a WebP — either would produce a path whose
 * extension lies about the content, which matters because the bucket has an
 * `allowed_mime_types` list.
 */
const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/heic": "heic",
};

export async function uploadToBucket(file: File, folder: string) {
  const supabase = createClient();
  const fromName = file.name.includes(".") ? file.name.split(".").pop()!.toLowerCase() : "";
  const ext = EXT_BY_MIME[file.type] || (fromName && fromName.length <= 5 ? fromName : "jpg");
  const path = `${folder}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from("naijamart").upload(path, file, {
    cacheControl: "31536000",
    upsert: false,
    contentType: file.type || undefined,
  });
  if (error) throw new Error(error.message);
  const { data } = supabase.storage.from("naijamart").getPublicUrl(path);
  return data.publicUrl;
}
