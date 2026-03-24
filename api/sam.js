const TOKEN = process.env.REPLICATE_API_TOKEN;
const REPLICATE_API = "https://api.replicate.com/v1";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  if (!TOKEN) return res.status(500).json({ error: "REPLICATE_API_TOKEN not set" });

  // POST — create a prediction
  if (req.method === "POST") {
    const { image, x, y } = req.body;
    if (!image) return res.status(400).json({ error: "image is required" });

    const response = await fetch(`${REPLICATE_API}/models/meta/sam-2-video/predictions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        "Content-Type": "application/json",
        Prefer: "wait",  // synchronous mode — blocks until done or timeout
      },
      body: JSON.stringify({
        input: {
          image,
          click_coordinates: `[${Math.round(x)},${Math.round(y)}]`,
          click_labels: "1",
          click_frames: "0",
          click_object_ids: "subject",
        },
      }),
    });

    const prediction = await response.json();

    // If completed synchronously, return output directly
    if (prediction.status === "succeeded") {
      return res.json({ status: "succeeded", output: prediction.output });
    }
    if (prediction.status === "failed") {
      return res.status(500).json({ status: "failed", error: prediction.error });
    }

    // Still processing — return prediction URL for polling
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
    const prediction = await response.json();
    return res.json({
      status: prediction.status,
      output: prediction.output,
      error: prediction.error,
      pollUrl: prediction.urls?.get,
    });
  }

  return res.status(405).json({ error: "Method not allowed" });
}

export const config = {
  maxDuration: 60,
};
