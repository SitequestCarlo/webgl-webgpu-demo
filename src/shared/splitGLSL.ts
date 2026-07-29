// Hilfsfunktion: Trennt eine kombinierte VS/FS .glsl Datei am zweiten
// Auftreten von "#version 300 es". Beide Teile beginnen jeweils mit #version.
export function splitGLSL(source: string): [vertex: string, fragment: string] {
  const marker = "#version 300 es";
  const first  = source.indexOf(marker);
  if (first === -1) return [source, ""];
  const second = source.indexOf(marker, first + marker.length);
  if (second === -1) return [source.slice(first).trim(), ""];
  return [source.slice(first, second).trim(), source.slice(second).trim()];
}
