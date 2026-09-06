import sharp from 'sharp';

/**
 * Perceptual hashing for visual similarity search.
 *
 * This computes a "difference hash" (dHash): the image is shrunk to a
 * tiny 9x8 grayscale grid, and each pixel is compared to its right-hand
 * neighbour. Each comparison produces one bit, giving a 64-bit
 * fingerprint that is stable under resizing, compression, and minor
 * color changes — the same idea used by TinEye/pHash-style reverse
 * image search, just without a neural embedding model behind it.
 *
 * Two images are considered visually similar when the Hamming distance
 * between their hashes is small. This is a genuine, real, deterministic
 * algorithm (not a random mock) that runs entirely offline. It will not
 * match the accuracy of a modern embedding-based visual search (e.g.
 * CLIP + a vector database), but it is a real implementation you can
 * swap out — see computeImageHash() below for where to plug one in.
 */

const HASH_WIDTH = 9;
const HASH_HEIGHT = 8;

export async function computeImageHash(imageBuffer: Buffer): Promise<string> {
  const { data } = await sharp(imageBuffer)
    .grayscale()
    .resize(HASH_WIDTH, HASH_HEIGHT, { fit: 'fill' })
    .raw()
    .toBuffer({ resolveWithObject: true });

  let bits = '';
  for (let row = 0; row < HASH_HEIGHT; row++) {
    for (let col = 0; col < HASH_WIDTH - 1; col++) {
      const left = data[row * HASH_WIDTH + col];
      const right = data[row * HASH_WIDTH + col + 1];
      bits += left > right ? '1' : '0';
    }
  }

  // Pack the 64-bit binary string into a hex string for compact storage.
  let hex = '';
  for (let i = 0; i < bits.length; i += 4) {
    hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
  }
  return hex;
}

export function hammingDistance(hexA: string, hexB: string): number {
  const len = Math.min(hexA.length, hexB.length);
  let distance = Math.abs(hexA.length - hexB.length) * 4;
  for (let i = 0; i < len; i++) {
    const xor = parseInt(hexA[i], 16) ^ parseInt(hexB[i], 16);
    distance += bitsSetTable[xor];
  }
  return distance;
}

// Precomputed popcount for a 4-bit nibble (0-15).
const bitsSetTable = [0, 1, 1, 2, 1, 2, 2, 3, 1, 2, 2, 3, 2, 3, 3, 4];

/** Converts a Hamming distance over a 64-bit hash into a 0-100 similarity score. */
export function similarityScore(distance: number, totalBits = 64): number {
  const score = ((totalBits - distance) / totalBits) * 100;
  return Math.max(0, Math.round(score));
}
