import { env, SamModel, AutoProcessor, RawImage } from "@huggingface/transformers";

// Use browser cache so model only downloads once
env.allowLocalModels = false;
env.useBrowserCache = true;

const MODEL_ID = "Xenova/mobile-sam";

let processor = null;
let model = null;
let storedImage = null;      // RawImage — needed for mask decoder too
let storedImageInputs = null; // encoder outputs (original_sizes, reshaped_input_sizes)
let storedEmbeddings = null;  // { image_embeddings, image_positional_embeddings }

self.onmessage = async ({ data }) => {
  try {
    switch (data.type) {

      case "load": {
        self.postMessage({ type: "progress", stage: "Downloading AI model…" });
        processor = await AutoProcessor.from_pretrained(MODEL_ID);
        self.postMessage({ type: "progress", stage: "Loading weights…" });
        model = await SamModel.from_pretrained(MODEL_ID, { dtype: "fp32" });
        self.postMessage({ type: "modelReady" });
        break;
      }

      case "encode": {
        const { pixels, width, height } = data;
        self.postMessage({ type: "progress", stage: "Analyzing image…" });
        // Build RawImage from raw RGBA pixel buffer
        storedImage = new RawImage(new Uint8ClampedArray(pixels), width, height, 4);
        storedImageInputs = await processor(storedImage);
        storedEmbeddings = await model.get_image_embeddings(storedImageInputs);
        self.postMessage({ type: "imageReady" });
        break;
      }

      case "segment": {
        const { x, y } = data; // pixel coords in original image space
        const input_points = [[[x, y]]];
        const input_labels = [[[1]]]; // 1 = foreground

        const maskInputs = await processor(storedImage, { input_points, input_labels });

        const outputs = await model({
          ...storedEmbeddings,
          input_points: maskInputs.input_points,
          input_labels: maskInputs.input_labels,
          image_size: maskInputs.image_size,
        });

        const masks = await processor.post_process_masks(
          outputs.pred_masks,
          storedImageInputs.original_sizes,
          storedImageInputs.reshaped_input_sizes,
        );

        // masks[0][0] is the best mask — a BoolTensor with dims [H, W]
        const mask = masks[0][0];
        self.postMessage({
          type: "maskReady",
          maskData: Array.from(mask.data), // Uint8Array of 0/1
          maskWidth: mask.dims[1],
          maskHeight: mask.dims[0],
        });
        break;
      }
    }
  } catch (err) {
    self.postMessage({ type: "error", message: err.message });
  }
};
