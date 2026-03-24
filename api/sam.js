const TOKEN = (process.env.REPLICATE_API_TOKEN || "").trim();
const REPLICATE_API = "https://api.replicate.com/v1";
const SAM2_VERSION = "fe97b453a6455861e3bac769b441ca1f1086110da7466dbb65cf1eecfd60dc83";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  if (!TOKEN) return res.status(500).json({ error: "REPLICATE_API_TOKEN not set" });

  try {
    // POST — create a SAM2 prediction (automatic mask generation)
    if (req.method === "POST") {
      const { image } = req.body;
      if (!image) return res.status(400).json({ error: "image is required" });

      const response = await fetch(`${REPLICATE_API}/predictions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${TOKEN}`,
          "Content-Type": "application/json",
          Prefer: "wait",
        },
        body: JSON.stringify({
          version: SAM2_VERSION,
          input: {
            image,
            points_per_side: 16,
            pred_iou_thresh: 0.86,
            stability_score_thresh: 0.92,
            use_m2m: true,
          },
        }),
      });

      if (!response.ok) {
        const text = await response.text();
        console.error("Replicate error:", response.status, text);
        return res.status(response.status).json({ error: `Replicate API ${response.status}: ${text.slice(0, 300)}` });
      }

      const prediction = await response.json();

      if (prediction.status === "succeeded") {
        return res.json({ status: "succeeded", output: prediction.output });
      }
      if (prediction.status === "failed") {
        return res.status(500).json({ status: "failed", error: prediction.error });
      }

      return res.json({
        status: prediction.status,
        pollUrl: prediction.urls?.get,
      });
    }

    // GET — poll an existing prediction
    if (req.method === "GET") {
      const { pollUrl } = req.query;
      if (!pollUrl) return res.status(400).json({ error: "pollUrl required" });

      const response = await fetch(pollUrl, {
        headers: { Authorization: `Bearer ${TOKEN}` },
      });
      if (!response.ok) {
        const text = await response.text();
        return res.status(response.status).json({ error: text.slice(0, 300) });
      }
      const prediction = await response.json();
      return res.json({
        status: prediction.status,
        output: prediction.output,
        error: prediction.error,
        pollUrl: prediction.urls?.get,
      });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    console.error("SAM API handler error:", err);
    return res.status(500).json({ error: err.message });
  }
}

export const config = {
  maxDuration: 60,
};
