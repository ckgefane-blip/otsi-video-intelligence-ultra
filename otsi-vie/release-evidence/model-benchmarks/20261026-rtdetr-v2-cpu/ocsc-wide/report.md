# Detector benchmark — ocsc_vs_oakland_ccby.webm

Machine: {'cpu': 'Intel64 Family 6 Model 170 Stepping 4, GenuineIntel', 'logical_cores': 22, 'ram_gb': 32, 'gpu': 'none (CPU only)', 'os': 'Windows-11-10.0.26300-SP0', 'python': '3.13.15'}

Sampled 12 frames from 133s at 1.0 fps. Thresholds for counting: person 0.5, ball 0.3.

| Model | Tiles | ms/frame (mean / p95) | frames/s | CPU cores used | Peak RAM MB | On-pitch persons/frame | Ball found (on pitch) | 90-min match at 2 fps (min) | Accuracy |
|---|---|---|---|---|---|---|---|---|---|
| rtdetr_v2_r18vd | 1 | 313.1 / 327.0 | 3.19 | 5.8 | 829 | 8.4 | 10/12 | 56 | not measured: no labelled ground truth for this footage |
| rtdetr_v2_r18vd | 2 | 1249.3 / 1441.1 | 0.8 | 8.1 | 1121 | 8.8 | 10/12 | 225 | not measured: no labelled ground truth for this footage |
