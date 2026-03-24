const FAL_KEY = (process.env.FAL_KEY || "").trim();
const FAL_QUEUE = "https://queue.fal.run/fal-ai/sam-3/image";
const FAL_REST = "https://rest.alpha.fal.ai";

async function uploadDataUri(dataUri, falKey) {
  // Parse data URI → Buffer
  const [meta, b64] = dataUri.split(",");
  const contentType = meta.match(/:(.*?);/)?.[1] || "image/jpeg";
  const buffer = Buffer.from(b64, "base64");

  // Step 1: Get auth token for fal CDN
  const tokenResp = await fetch(
    `${FAL_REST}/storage/auth/token?storage_type=fal-cdn-v3`,
    {
      method: "POST",
      headers: {
        Authorization: `Key ${falKey}`,
        "Content-Type": "application/json",
      },
      body: "{}",
    }
  );
  if (!tokenResp.ok) {
    const detail = await tokenResp.text();
    throw new Error(`Storage auth failed: ${tokenResp.status} ${detail}`);
  }
  const { token, token_type, base_url } = await tokenResp.json();

  // Step 2: Upload file bytes to fal CDN
  const uploadResp = await fetch(`${base_url}/files/upload`, {
    method: "POST",
    headers: {
      Authorization: `${token_type} ${token}`,
      "Content-Type": contentType,
      "X-Fal-File-Name": `upload-${Date.now()}.${contentType.split("/")[1] || "jpg"}`,
    },
    body: buffer,
  });
  if (!uploadResp.ok) throw new Error(`Upload failed: ${uploadResp.status}`);
  const { access_url } = await uploadResp.json();

  return access_url;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (!FAL_KEY) return res.status(500).json({ error: "FAL_KEY not set" });

  const headers = {
    Authorization: `Key ${FAL_KEY}`,
    "Content-Type": "application/json",
  };

  try {
    // POST — submit a new SAM3 request to the queue
    if (req.method === "POST") {
      let { image_url, point_prompts, prompt } = req.body;
      if (!image_url) return res.status(400).json({ error: "image_url is required" });

      // Upload data URIs to fal storage first
      if (image_url.startsWith("data:")) {
        image_url = await uploadDataUri(image_url, FAL_KEY);
      }

      const input = { image_url, apply_mask: false, output_format: "png", return_multiple_masks: true };
      if (point_prompts?.length) input.point_prompts = point_prompts;
      else if (prompt) input.prompt = prompt;

      const response = await fetch(FAL_QUEUE, {
        method: "POST",
        headers,
        body: JSON.stringify(input),
      });

      if (!response.ok) {
        const text = await response.text();
        return res.status(response.status).json({ error: `fal.ai ${response.status}: ${text.slice(0, 300)}` });
      }

      const queue = await response.json();
      // Return queue info so frontend can poll
      return res.json({
        status: queue.status,
        requestId: queue.request_id,
        statusUrl: queue.status_url,
        resultUrl: queue.response_url,
      });
    }

    // GET — poll status or fetch result
    if (req.method === "GET") {
      const { statusUrl, resultUrl } = req.query;

      // Check status
      if (statusUrl) {
        const response = await fetch(statusUrl, { headers });
        const data = await response.json();

        // If completed, fetch the result immediately
        if (data.status === "COMPLETED" && resultUrl) {
          const resultResp = await fetch(resultUrl, { headers });
          if (resultResp.ok) {
            const result = await resultResp.json();
            return res.json({ status: "COMPLETED", ...result });
          }
        }

        return res.json({ status: data.status });
      }

      return res.status(400).json({ error: "statusUrl required" });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    console.error("SAM API error:", err);
    return res.status(500).json({ error: err.message });
  }
}

export const config = { maxDuration: 15 };
