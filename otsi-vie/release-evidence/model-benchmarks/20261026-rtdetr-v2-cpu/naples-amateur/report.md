# Detector benchmark — naples_amateur_pd.webm

Machine: {'cpu': 'Intel64 Family 6 Model 170 Stepping 4, GenuineIntel', 'logical_cores': 22, 'ram_gb': 32, 'gpu': 'none (CPU only)', 'os': 'Windows-11-10.0.26300-SP0', 'python': '3.13.15'}

Sampled 12 frames from 0s at 0.5 fps. Thresholds for counting: person 0.5, ball 0.3.

| Model | Tiles | ms/frame (mean / p95) | frames/s | CPU cores used | Peak RAM MB | On-pitch persons/frame | Ball found (on pitch) | 90-min match at 2 fps (min) | Accuracy |
|---|---|---|---|---|---|---|---|---|---|
| rtdetr_v2_r18vd | 1 | 305.2 / 314.4 | 3.28 | 5.2 | 667 | 4.1 | 3/12 | 55 | not measured: no labelled ground truth for this footage |
| rtdetr_v2_r18vd | 2 | 1209.2 / 1274.0 | 0.83 | 8.7 | 1116 | 4.2 | 3/12 | 218 | not measured: no labelled ground truth for this footage |
