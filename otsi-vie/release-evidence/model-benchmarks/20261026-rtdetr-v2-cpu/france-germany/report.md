# Detector benchmark — france_germany_ccbysa.ogv

Machine: {'cpu': 'Intel64 Family 6 Model 170 Stepping 4, GenuineIntel', 'logical_cores': 22, 'ram_gb': 32, 'gpu': 'none (CPU only)', 'os': 'Windows-11-10.0.26300-SP0', 'python': '3.13.15'}

Sampled 12 frames from 0s at 1.0 fps. Thresholds for counting: person 0.5, ball 0.3.

| Model | Tiles | ms/frame (mean / p95) | frames/s | CPU cores used | Peak RAM MB | On-pitch persons/frame | Ball found (on pitch) | 90-min match at 2 fps (min) | Accuracy |
|---|---|---|---|---|---|---|---|---|---|
| rtdetr_v2_r18vd | 1 | 297.2 / 305.7 | 3.36 | 5.2 | 666 | 10.1 | 1/12 | 53 | not measured: no labelled ground truth for this footage |
| rtdetr_v2_r18vd | 2 | 1148.7 / 1226.7 | 0.87 | 8.8 | 1120 | 17.8 | 12/12 | 207 | not measured: no labelled ground truth for this footage |
