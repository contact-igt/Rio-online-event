// The browser's PUT of the video straight to the bucket, with progress. The presigned URL is signed for exactly this content type, so the
// header must match it. Nothing passes through this site or the API.

export class PutError extends Error {}

export function putFile(url: string, file: File, type: string, onProgress: (pct: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Type", type);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(Math.min(99, Math.floor((e.loaded / e.total) * 100)));
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new PutError("status")));
    xhr.onerror = () => reject(new PutError("network"));
    xhr.onabort = () => reject(new PutError("aborted"));
    xhr.send(file);
  });
}
