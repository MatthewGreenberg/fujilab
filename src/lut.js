/*
  .3dl LUT parser
  Supports Autodesk/Lustre style .3dl files.
*/
export function parse3DL(text) {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith("#"));
  const triplets = [];
  let shaperLine = null;

  for (const line of lines) {
    const parts = line.split(/\s+/).map(Number);
    if (parts.some(isNaN)) continue;
    if (parts.length >= 3) {
      if (triplets.length === 0 && parts.length > 3) {
        shaperLine = parts;
        continue;
      }
      triplets.push([parts[0], parts[1], parts[2]]);
    } else if (parts.length > 0 && triplets.length === 0) {
      shaperLine = parts;
    }
  }

  const count = triplets.length;
  const size = Math.round(Math.pow(count, 1 / 3));
  if (size * size * size !== count) {
    throw new Error(`Cannot determine grid size: ${count} entries`);
  }

  let maxVal = 0;
  for (const [r, g, b] of triplets) maxVal = Math.max(maxVal, r, g, b);
  const bitDepth = maxVal <= 255 ? 255 : maxVal <= 1023 ? 1023 : maxVal <= 4095 ? 4095 : 65535;

  const data = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    data[i * 3] = triplets[i][0] / bitDepth;
    data[i * 3 + 1] = triplets[i][1] / bitDepth;
    data[i * 3 + 2] = triplets[i][2] / bitDepth;
  }

  return { size, data };
}

/*
  .cube LUT parser
*/
export function parseCube(text) {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith("#"));
  let size = 0;
  const triplets = [];

  for (const line of lines) {
    if (line.startsWith("LUT_3D_SIZE")) { size = parseInt(line.split(/\s+/)[1]); continue; }
    if (line.startsWith("LUT_") || line.startsWith("DOMAIN_") || line.startsWith("TITLE")) continue;
    const parts = line.split(/\s+/).map(Number);
    if (parts.length >= 3 && !parts.some(isNaN)) triplets.push(parts);
  }

  if (!size) size = Math.round(Math.pow(triplets.length, 1 / 3));
  const data = new Float32Array(triplets.length * 3);
  for (let i = 0; i < triplets.length; i++) {
    data[i * 3] = triplets[i][0];
    data[i * 3 + 1] = triplets[i][1];
    data[i * 3 + 2] = triplets[i][2];
  }

  return { size, data };
}

