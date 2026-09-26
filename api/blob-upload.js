// Issues short-lived upload tokens so the browser can put files over 4.5 MB straight
// into Blob storage; the Python API then reads them by URL.
import { handleUpload } from "@vercel/blob/client";

const AUDIO_AND_PAYLOADS = 100 * 1024 * 1024;

export default async function handler(req, res) {
  try {
    const result = await handleUpload({
      body: req.body,
      request: req,
      onBeforeGenerateToken: async (pathname) => {
        if (!pathname.startsWith("in/")) throw new Error("bad upload path");
        return { maximumSizeInBytes: AUDIO_AND_PAYLOADS, addRandomSuffix: true };
      },
    });
    res.status(200).json(result);
  } catch (err) {
    res.status(400).json({ error: String(err.message || err) });
  }
}
