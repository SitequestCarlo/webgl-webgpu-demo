// Draw-Uniform Hilfsfunktionen für Benchmark-Showcases (05, 06, 09).

/** Größe eines Draw-Uniforms in Bytes (256-Byte-aligned für Dynamic Offsets). */
export const DRAW_UNIFORM_SIZE = 256;

/**
 * Füllt den Draw-Uniform-Buffer für ein Objekt.
 * @param out         Float32Array (64 Floats = 256 Bytes pro Draw)
 * @param floatOffset Float32-Offset im Buffer
 * @param model       mat4 (16 floats)
 * @param normalMat   mat4 aus mat3 (16 floats)
 * @param color       RGB-Farbe
 */
export function writeDrawUniform(
  out: Float32Array,
  floatOffset: number,
  model: Float32Array,
  normalMat: Float32Array,
  color: [number, number, number],
): void {
  out.set(model,     floatOffset);
  out.set(normalMat, floatOffset + 16);
  out[floatOffset + 32] = color[0];
  out[floatOffset + 33] = color[1];
  out[floatOffset + 34] = color[2];
  out[floatOffset + 35] = 1.0;
}
