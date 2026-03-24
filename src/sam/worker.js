import { env, SamModel, AutoProcessor, RawImage } from "@huggingface/transformers";

env.allowLocalModels = false;
env.useBrowserCache = true;

const MODEL_ID = "Xenova/sam-vit-base";

let processor = null;
let model = null;
let storedImage = null;
let storedInputs = null;
let storedEmbeddings = null;

function pickBestMask(masks, iouScores) {
  const maskTensor = masks[0]; // [1, 3, H, W]
  const h = maskTensor.dims[2];
  const w = maskTensor.dims[3];
  const scores = iouScores.data;
  let bestIdx = 0;
  for (let i = 1; i < scores.length; i++) {
    if (scores[i] > scores[bestIdx]) bestIdx = i;
  }
  const maskData = new Uint8Array(h * w);
  const offset = bestIdx * h * w;
  for (let i = 0; i < h * w; i++) {
    maskData[i] = maskTensor.data[offset + i] ? 1 : 0;
  }
  return { maskData, maskWidth: w, maskHeight: h };
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
  return pickBestMask(masks, outputs.iou_scores);
}

self.onmessage = async ({ data }) => {
  try {
    switch (data.type) {

      case "load": {
        self.postMessage({ type: "progress", stage: "Downloading AI model…" });
        processor = await AutoProcessor.from_pretrained(MODEL_ID);
        self.postMessage({ type: "progress", stage: "Loading weights…" });
        // Try WebGPU first for speed, fall back to WASM
        let device = "wasm";
        try {
          if (typeof navigator !== "undefined" && navigator.gpu) {
            const adapter = await navigator.gpu.requestAdapter();
            if (adapter) device = "webgpu";
          }
        } catch { /* no WebGPU */ }
        model = await SamModel.from_pretrained(MODEL_ID, { dtype: "q8", device });
        self.postMessage({ type: "modelReady", device });
        break;
      }

      case "encode": {
        const { pixels, width, height } = data;
        self.postMessage({ type: "progress", stage: "Analyzing image…" });
        storedImage = new RawImage(new Uint8ClampedArray(pixels), width, height, 4);
        storedInputs = await processor(storedImage);
        storedEmbeddings = await model.get_image_embeddings(storedInputs);

        // Auto-select: segment at center of image
        self.postMessage({ type: "progress", stage: "Finding subject…" });
        const result = await segmentAtPoint(width / 2, height / 2);
        self.postMessage({ type: "imageReady" });
        self.postMessage({ type: "autoMask", ...result });
        break;
      }

      case "segment": {
        if (!storedImage || !storedEmbeddings) {
          self.postMessage({ type: "error", message: "No image encoded yet" });
          return;
        }
        const result = await segmentAtPoint(data.x, data.y);
        self.postMessage({ type: "maskReady", ...result });
        break;
      }
    }
  } catch (err) {
    self.postMessage({ type: "error", message: err.message });
  }
};
