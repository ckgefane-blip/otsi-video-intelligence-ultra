# Detector benchmark — ocsc_vs_oakland_ccby.webm

Machine: {'cpu': 'Intel64 Family 6 Model 170 Stepping 4, GenuineIntel', 'logical_cores': 22, 'ram_gb': 32, 'gpu': 'none (CPU only)', 'os': 'Windows-11-10.0.26300-SP0', 'python': '3.13.15'}

Sampled 12 frames from 80s at 1.0 fps. Thresholds for counting: person 0.5, ball 0.3.

| Model | Tiles | ms/frame (mean / p95) | frames/s | CPU cores used | Peak RAM MB | On-pitch persons/frame | Ball found (on pitch) | 90-min match at 2 fps (min) | Accuracy |
|---|---|---|---|---|---|---|---|---|---|
| rtdetr_v2_r18vd | 1 | 338.6 / 351.6 | 2.95 | 5.0 | 827 | 6.2 | 10/12 | 61 | not measured: no labelled ground truth for this footage |
| rtdetr_v2_r18vd | 2 | 1128.2 / 1197.8 | 0.89 | 8.9 | 1120 | 6.6 | 12/12 | 203 | not measured: no labelled ground truth for this footage |
| rtdetr_v2_r50vd | 1 | 616.0 / 723.1 | 1.62 | 6.9 | 1215 | 5.5 | 9/12 | 111 | not measured: no labelled ground truth for this footage |
| rtdetr_v2_r50vd | 2 | 2531.9 / 2634.0 | 0.39 | 9.2 | 1334 | 6.2 | 10/12 | 456 | not measured: no labelled ground truth for this footage |
