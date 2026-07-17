# Rendering-Vergleich: Raytracing vs. Path Tracing

Eine **gemeinsame Cornell-Box** wird mit drei umschaltbaren Verfahren gerendert. Weil Szene,
Kamera und Materialien identisch bleiben, wird der Unterschied allein durch das
Beleuchtungsmodell sichtbar.

## Die drei Modi

| Modus | Direktes Licht | Indirektes Licht (GI) | Rauschen |
|---|---|---|---|
| **Whitted-Raytracing** | harte Schatten (1 Schattenstrahl) | keines | keines |
| **Path Tracing (naiv)** | zufällig getroffen | vollständig | stark |
| **Path Tracing (NEE)** | direkte Lichtstichprobe | vollständig | gering |

- **Whitted:** Diffuse Flächen erhalten nur direktes Licht; Ecken, Decke und Unterseiten
  bleiben **schwarz**, weil kein indirektes Licht existiert. Spiegel und Glas werden rekursiv
  weiterverfolgt.
- **Path Tracing (naiv):** Volle globale Beleuchtung, aber die Lampe wird nur zufällig von
  Bounce-Strahlen getroffen. Das konvergiert korrekt, jedoch **langsam** (viel Rauschen).
- **Path Tracing (NEE):** Zusätzlich zur zufälligen Streuung wird an jedem diffusen Treffer
  **gezielt die Lichtquelle abgetastet** (Next Event Estimation). Das liefert dasselbe Bild
  wie der naive Pfad, nur mit **deutlich weniger Rauschen**.

## Next Event Estimation

An jedem diffusen Treffer wird ein Punkt auf der Halbkugel-Lampe gesampelt und ein
Schattenstrahl dorthin geschickt. Der direkte Beitrag ist:

$$L_\text{direkt} = \frac{\text{Albedo}}{\pi}\; L_e\; \frac{\cos\theta_\text{Fläche}\,\cos\theta_\text{Licht}}{d^2}\; A$$

mit Lichtfläche $A = 2\pi r^2$ (untere Halbkugel). Um Doppelzählung zu vermeiden, wird die
Emission bei einem *zufällig* getroffenen Licht ignoriert — nur über den Primärstrahl oder
spekulare (Spiegel/Glas) Pfade bleibt die Lampe direkt sichtbar (`specular`-Flag).

> **Ist NEE Schummeln?** Nein. NEE ist eine **Varianzreduktion** — es konvergiert gegen dasselbe
> Ergebnis wie der naive Pfad. Es macht den Vergleich *ehrlicher*, weil der wesentliche
> Unterschied (die indirekte Beleuchtung) nicht mehr im Rauschen untergeht.

## Was zeigt die Szene?

- **Rote linke** und **grüne rechte Wand** — im Path-Tracing-Modus färben sie Boden und
  benachbarte Flächen ein (*Color Bleeding*), im Whitted-Modus nicht.
- **Spiegel-Kugel** (perfekte Reflexion) und **Glas-Kugel** (Brechung, IOR 1.5).
- **Halbkugel-Lampe** an der Decke, die nur nach unten strahlt — deshalb bleibt die Decke dunkel.

## WebGL vs. WebGPU

| | WebGL2 | WebGPU |
|---|---|---|
| Akkumulation | `preserveDrawingBuffer` + Alpha-Blending | **Storage Buffer** (HDR) |
| RNG | Hash pro Frame (stateless) | **Xorshift32** persistenter Zustand pro Pixel |
| Tone-Mapping | vor der Akkumulation (LDR-Bias) | nach der Akkumulation (korrekt) |
| Schattenstrahlen | im Fragment-Shader | im Compute-Shader |

Die Kamera orbitiert per **Maus-Drag**. Bei jeder Bewegung und jedem Moduswechsel wird die
Akkumulation zurückgesetzt.
