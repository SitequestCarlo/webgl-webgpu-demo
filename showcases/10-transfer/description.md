# Buffer Transfer

Bewegt einen Puffer der Größe **S (1 – 256 MB)** zwischen CPU und GPU und misst den
**Transfer-Durchsatz (GB/s)** bzw. die **Latenz pro Transfer**. Drei Richtungen: **Upload**,
**Readback**, **Roundtrip** — und für WebGPU zwei Pfade: **naiv** und **optimiert** (`?opt=1`
bzw. GUI-Toggle *„Optimiert (mapped Staging)"*).

## Kernaussage

WebGPU trennt Staging explizit: Readback läuft über einen mappbaren Staging-Buffer
(`copyBufferToBuffer` → `mapAsync`) **asynchron**; WebGLs `getBufferSubData` ist dagegen
**synchron** und stallt den Main-Thread hart. Der **naive** WebGPU-Upload (`queue.writeBuffer`)
ist deutlich langsamer als WebGL — mit **mapped Staging** halbiert sich der Abstand.

> WebGPU ist hier **nicht inherent langsamer**: Der *naive* `writeBuffer`-Pfad ist es. Mit der
> richtigen Technik (mapped Buffer / pre-mapped Ring) erreicht bzw. schlägt WebGPU WebGL.

## Drei Varianten (drei Balken)

| Variante | Upload | Readback |
|---|---|---|
| **WebGL2** | `bufferSubData` + Fence (`glFenceAsync`) | `getBufferSubData` (synchron, blockiert) |
| **WebGPU naiv** | `queue.writeBuffer` + `onSubmittedWorkDone` | `copyBufferToBuffer` → `mapAsync` (Pool) |
| **WebGPU opt** | `MAP_WRITE`-Staging: **einmal** Host-Write + K× `copyBufferToBuffer` | wie naiv |

Pro Zeitmessung werden **K Transfers gebündelt** (K so, dass K·S ≈ 256 MB) und die Batch-Zeit
durch K geteilt → amortisiert die feste Sync-Latenz, misst **echte Bandbreite** statt
Latenz-Sockel bei kleinen Größen. Primärmetrik ist die **CPU-Wall-Clock-Latenz** (`metric: "cpu"`),
`GB/s = Bytes / 1e9 / (medMs / 1000)`.
