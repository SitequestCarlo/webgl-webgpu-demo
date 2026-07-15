# Draw-Call Overhead

**N Würfel (100–50.000)**, jeder mit einem eigenen Draw-Call.
Misst den **CPU-seitigen API-Overhead** — nicht die GPU-Leistung.

## Was wird gemessen?

Die CPU-Zeit für N Aufrufe der Draw-Funktion, gemessen mit `performance.now()`:

```typescript
cpuTimer.begin();
for (let i = 0; i < N; i++) {
    // Pro Draw-Call: Uniforms setzen + Draw
}
cpuTimer.end();  // → cpuMs im GUI
```

## WebGL: Immediate Mode

Jeder Draw-Call ist sofort ein JS→Native-Grenzübertritt:

```typescript
gl.uniformMatrix4fv(uModel, false, matrix);  // State mutation
gl.uniform3fv(uColor, color);
gl.drawElements(gl.TRIANGLES, 36, gl.UNSIGNED_INT, 0);  // Sofort an GPU
```

## WebGPU: Command Recording

Commands werden erst **aufgezeichnet**, dann einmalig übermittelt:

```typescript
const pass = cmd.beginRenderPass(...);
for (let i = 0; i < N; i++) {
    pass.setBindGroup(1, bindGroup, [i * 256]);  // Dynamic Offset
    pass.drawIndexed(36);
}
pass.end();
device.queue.submit([cmd.finish()]);  // Einmaliger GPU-Submit
```

## Erwartetes Ergebnis

| N | WebGL2 | WebGPU |
|---|---|---|
| 1.000 | ~0.5ms | ~0.1ms |
| 10.000 | ~5ms | ~0.8ms |
| 50.000 | >30ms | ~4ms |

WebGPU ist bei vielen Draw-Calls deutlich effizienter, weil die Command-Buffer-Validierung
erst beim `submit()` stattfindet, nicht pro Draw-Call.
