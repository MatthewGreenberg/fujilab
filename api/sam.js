const FAL_KEY = (process.env.FAL_KEY || "").trim();
const FAL_QUEUE = "https://queue.fal.run/fal-ai/sam-3/image";

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
      const { image_url, point_prompts, prompt } = req.body;
      if (!image_url) return res.status(400).json({ error: "image_url is required" });

      const input = { image_url, apply_mask: false, output_format: "png" };
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
