const FAL_KEY = (process.env.FAL_KEY || "").trim();

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!FAL_KEY) return res.status(500).json({ error: "FAL_KEY not set" });

  try {
    const { image_url, point_prompts, prompt } = req.body;
    if (!image_url) return res.status(400).json({ error: "image_url is required" });

    const input = {
      image_url,
      apply_mask: false,       // return mask only, not composited
      output_format: "png",
    };

    // Point-click mode: user clicked a specific spot
    if (point_prompts?.length) {
      input.point_prompts = point_prompts;
    }
    // Text prompt mode (auto-select): e.g. "person" or "subject"
    else if (prompt) {
      input.prompt = prompt;
    }

    const response = await fetch("https://fal.run/fal-ai/sam-3/image", {
      method: "POST",
      headers: {
        Authorization: `Key ${FAL_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(input),
    });

    if (!response.ok) {
      const text = await response.text();
      console.error("fal.ai error:", response.status, text);
      return res.status(response.status).json({ error: `fal.ai ${response.status}: ${text.slice(0, 300)}` });
    }

    const result = await response.json();
    return res.json(result);
  } catch (err) {
    console.error("SAM API handler error:", err);
    return res.status(500).json({ error: err.message });
  }
}

export const config = {
  maxDuration: 30,
};
