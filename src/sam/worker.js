import { env, SamModel, AutoProcessor, RawImage } from "@huggingface/transformers";

// Browser cache so the model only downloads once (~100MB quantized)
env.allowLocalModels = false;
env.useBrowserCache = true;

const MODEL_ID = "Xenova/sam-vit-base";

let processor = null;
let model = null;
let storedImage = null;      // RawImage — needed for processor calls
let storedInputs = null;     // processor output (pixel_values, original_sizes, reshaped_input_sizes)
let storedEmbeddings = null;  // { image_embeddings, image_positional_embeddings }

self.onmessage = async ({ data }) => {
  try {
    switch (data.type) {

      case "load": {
        self.postMessage({ type: "progress", stage: "Downloading AI model…" });
        processor = await AutoProcessor.from_pretrained(MODEL_ID);
        self.postMessage({ type: "progress", stage: "Loading weights…" });
        model = await SamModel.from_pretrained(MODEL_ID, {
          dtype: "q8", // quantized — ~100MB vs 350MB fp32
        });
        self.postMessage({ type: "modelReady" });
        break;
      }

      case "encode": {
        const { pixels, width, height } = data;
        self.postMessage({ type: "progress", stage: "Analyzing image…" });

        // Build RawImage from raw RGBA pixel buffer
        storedImage = new RawImage(new Uint8ClampedArray(pixels), width, height, 4);

        // Processor call — returns pixel_values, original_sizes, reshaped_input_sizes
        storedInputs = await processor(storedImage);

        // Compute image embeddings (expensive — ~2-5s, done once per image)
        storedEmbeddings = await model.get_image_embeddings(storedInputs);

        self.postMessage({ type: "imageReady" });
        break;
      }

      case "segment": {
        if (!storedImage || !storedEmbeddings) {
          self.postMessage({ type: "error", message: "No image encoded yet" });
          return;
        }
        const { x, y } = data; // pixel coords in original image space
        const input_points = [[[x, y]]];
        const input_labels = [[[1]]]; // 1 = foreground

        // Re-process image with point prompts (fast — just builds tensors)
        const inputs = await processor(storedImage, { input_points, input_labels });

        // Run mask decoder with cached image embeddings
        const outputs = await model({
          ...storedEmbeddings,
          input_points: inputs.input_points,
          input_labels: inputs.input_labels,
        });

        // Post-process masks back to original image resolution
        const masks = await processor.post_process_masks(
          outputs.pred_masks,
          inputs.original_sizes,
          inputs.reshaped_input_sizes,
        );

        // masks[0] is a Tensor with dims [1, 3, H, W] (3 mask candidates)
        // Pick the best mask using iou_scores
        const scores = outputs.iou_scores.data; // Float32Array with 3 scores
        let bestIdx = 0;
        for (let i = 1; i < scores.length; i++) {
          if (scores[i] > scores[bestIdx]) bestIdx = i;
        }

        // Extract the best mask — masks[0] has shape [1, 3, H, W]
        const maskTensor = masks[0]; // [1, 3, H, W]
        const h = maskTensor.dims[2];
        const w = maskTensor.dims[3];
        const maskData = new Uint8Array(h * w);
        const offset = bestIdx * h * w;
        for (let i = 0; i < h * w; i++) {
          maskData[i] = maskTensor.data[offset + i] ? 1 : 0;
        }

        self.postMessage({
          type: "maskReady",
          maskData: Array.from(maskData),
          maskWidth: w,
          maskHeight: h,
        });
        break;
      }
    }
  } catch (err) {
    self.postMessage({ type: "error", message: err.message });
  }
};
