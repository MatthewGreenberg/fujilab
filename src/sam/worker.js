import { env, SamModel, AutoProcessor, RawImage } from "@huggingface/transformers";

env.allowLocalModels = false;
env.useBrowserCache = true;

const MODEL_ID = "Xenova/sam-vit-base";

let processor = null;
let model = null;
let storedImage = null;
let storedInputs = null;
let storedEmbeddings = null;  // multi-level: { "image_embeddings.0", ".1", ".2" }

function extractBestMask(masks, iouScores) {
  const maskTensor = masks[0]; // [1, N, 3, H, W] or [1, 3, H, W]
  const dims = maskTensor.dims;
  // SAM2 returns [batch, num_prompts, 3, H, W] — flatten to find h/w
  const h = dims[dims.length - 2];
  const w = dims[dims.length - 1];
  const scores = iouScores.data;

  let bestIdx = 0;
  for (let i = 1; i < scores.length; i++) {
    if (scores[i] > scores[bestIdx]) bestIdx = i;
  }

  const maskData = new Uint8Array(h * w);
  const stride = h * w;
  const offset = bestIdx * stride;
  let count = 0;
  for (let i = 0; i < stride; i++) {
    if (maskTensor.data[offset + i]) {
      maskData[i] = 1;
      count++;
    }
  }
  return { maskData, maskWidth: w, maskHeight: h, coverage: count / stride };
}

async function segmentAtPoint(x, y) {
  const input_points = [[[x, y]]];
  const input_labels = [[[1]]];
  const inputs = await processor(storedImage, { input_points, input_labels });

  const outputs = await model({
    ...storedEmbeddings,
    input_points: inputs.input_points,
    input_labels: inputs.input_labels,
  });

  const masks = await processor.post_process_masks(
    outputs.pred_masks,
    inputs.original_sizes,
    inputs.reshaped_input_sizes,
  );
  return extractBestMask(masks, outputs.iou_scores);
}

self.onmessage = async ({ data }) => {
  try {
    switch (data.type) {

      case "load": {
        self.postMessage({ type: "progress", stage: "Downloading AI model…" });
        processor = await AutoProcessor.from_pretrained(MODEL_ID);
        self.postMessage({ type: "progress", stage: "Loading weights…" });
        model = await SamModel.from_pretrained(MODEL_ID, { dtype: "q8" });
        self.postMessage({ type: "modelReady" });
        break;
      }

      case "encode": {
        const { pixels, width, height } = data;
        self.postMessage({ type: "progress", stage: "Analyzing image…" });
        storedImage = new RawImage(new Uint8ClampedArray(pixels), width, height, 4);
        storedInputs = await processor(storedImage);
        storedEmbeddings = await model.get_image_embeddings(storedInputs);
        self.postMessage({ type: "imageReady" });

        // Auto-select: try center, then quadrants, pick best non-huge mask
        self.postMessage({ type: "progress", stage: "Finding subject…" });
        const cx = width / 2, cy = height / 2;
        const candidates = [
          [cx, cy],
          [cx, cy * 0.6],           // upper center (faces)
          [cx * 0.6, cy * 0.6],     // upper left
          [cx * 1.4, cy * 0.6],     // upper right
          [cx * 0.6, cy * 1.3],     // lower left
          [cx * 1.4, cy * 1.3],     // lower right
        ];

        let bestMask = null;
        for (const [px, py] of candidates) {
          const result = await segmentAtPoint(
            Math.min(width - 1, Math.max(0, px)),
            Math.min(height - 1, Math.max(0, py)),
          );
          // Want a subject, not the background: between 2% and 45% coverage
          if (result.coverage >= 0.02 && result.coverage <= 0.45) {
            if (!bestMask || result.coverage > bestMask.coverage) {
              bestMask = result;
            }
          }
        }

        if (bestMask) {
          self.postMessage({
            type: "autoMask",
            maskData: Array.from(bestMask.maskData),
            maskWidth: bestMask.maskWidth,
            maskHeight: bestMask.maskHeight,
          });
        }
        break;
      }

      case "segment": {
        if (!storedImage || !storedEmbeddings) {
          self.postMessage({ type: "error", message: "No image encoded yet" });
          return;
        }
        const result = await segmentAtPoint(data.x, data.y);
        self.postMessage({
          type: "maskReady",
          maskData: Array.from(result.maskData),
          maskWidth: result.maskWidth,
          maskHeight: result.maskHeight,
        });
        break;
      }
    }
  } catch (err) {
    self.postMessage({ type: "error", message: err.message });
  }
};
