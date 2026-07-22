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

## Gemessene Latenz (RTX 4070, Roundtrip, Median ms/Transfer)

| S (MB) | WebGL | WebGPU naiv | WebGPU opt |
|---:|---:|---:|---:|
| 1 | 0,64 | 1,27 | 1,68 |
| 4 | 1,51 | 13,72 | **5,64** |
| 16 | 7,04 | 44,14 | **20,77** |
| 64 | 35,56 | 190,55 | **113,30** |
| 256 | 124,10 | 520,60 | **431,40** |

## Warum WebGPU (naiv) langsamer ist — drei Overhead-Quellen

Der Mehraufwand verteilt sich **größenabhängig** auf drei Ursachen:

1. **Synchronisations-/Round-Trip-Latenz — dominiert bei KLEINEN Größen.**
   Jedes `onSubmittedWorkDone()`/`mapAsync()` ist ein CPU↔GPU-Fence-Round-Trip (frühestens ein
   Event-Loop-Tick). Bei 1 MB ist die reine Datenbewegung trivial → ~1 ms ist fast reiner
   Overhead; `mapAsync(WRITE)` macht den opt-Pfad hier sogar minimal langsamer.

2. **CPU-Kopier-Overhead — dominiert den naiven Pfad bei MITTLEREN Größen.**
   Naiv macht K× `writeBuffer` → K× **memcpy** in Dawns internes Staging-Heap (bei 4 MB ist
   K = 64). Der opt-Pfad schreibt **einmal** in gemapptes Staging → ~2× schneller (4–64 MB).

3. **IPC-Lock-Step großer `writeBuffer`-Befehle — dominiert bei GROSSEN Größen.**
   Ein sehr großer `writeBuffer` passt nicht in einen IPC-Command-Buffer zwischen Renderer- und
   GPU-Prozess. Chrome zerstückelt ihn und die beiden Prozesse arbeiten **im Lock-Step** (jeder
   Chunk wartet auf Bestätigung) → hoher Sync-Overhead auf **Prozessebene**. WebGL hat eine
   eigene `bufferSubData`-Implementierung, die große Uploads intern effizient aufteilt.

## Belege / Referenzen

- **Chromium-Issue [40066114](https://issues.chromium.org/issues/40066114)** („[WebGPU] Buffer
  performance seems worse than WebGL", ehem. crbug 1456409, P2, offen) — beschreibt genau diesen
  Effekt:
  - *„the writeBuffer command is getting so large it doesn't fit in one command … ends up having
    the GPU/Renderer processes talk to each other **in lock step**."* (Kommentar 11)
  - *„the best performance will come from the application using **mapped buffers** instead of
    writeBuffer … saving one copy."* (Kommentar 11)
  - Ein **Ring aus vorab-gemappten Transfer-Buffern** war *„at least twice as fast as WebGL"*
    (Kommentar 12, greggman); mit korrektem Update-Pfad war WebGPU **~40 % schneller** als WebGL
    (Kommentar 14).
  - **Plattformabhängig** (Windows/Metal stärker betroffen als Linux; Kommentar 6/10).
- Übergeordneter Tracker: *„WebGPU performance is competitive with WebGL…"* (Issue 345276401).

## Wichtiger Messmethodik-Vorbehalt

Der Benchmark misst **Latenz bis zur Fertigstellung** (erzwungener Sync pro Transfer) — der
**Worst Case für WebGPUs async Design**. In echten Anwendungen überlappt man Transfers mit
Rendering/Compute und wartet nie; dann verschwindet der Sync-Anteil, während WebGLs
`getBufferSubData` immer den Thread stallt. Die reine Wall-Clock-Zeit **überzeichnet** hier also
WebGPUs realen Kostenanteil.

## Weitere methodische Hinweise

- **mapAsync-Latenz-Untergrenze** verzerrt kleine Größen → Sweep bis 256 MB, wo Bandbreite dominiert.
- GB/s aus dem **Median**, nicht dem Mittelwert (robust gegen einzelne Hitches / GC).
- Puffer werden außerhalb der Messschleife allokiert (kein GC-Rauschen in der Messung).
- 256 MB entspricht dem WebGPU-Default-Limit `maxBufferSize` (256 MiB) — auf schwächeren Geräten
  kann diese Stufe fehlschlagen.
- Der **nächste Optimierungsschritt** wäre ein **persistenter Ring vorab-gemappter Staging-Buffer**
  (nie auf ein Mapping warten) — laut Issue der Weg, mit dem WebGPU WebGL einholt/überholt.
