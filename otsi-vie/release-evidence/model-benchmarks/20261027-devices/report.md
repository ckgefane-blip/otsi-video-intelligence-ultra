# Detector runtime benchmark (RT-DETRv2-R18) — ocsc_vs_oakland_ccby.webm, france_germany_ccbysa.ogv

Machine: {'cpu': 'Intel Core Ultra 7 155H', 'logical_cores': 22, 'ram_gb': 31.5, 'openvino_devices': {'CPU': 'Intel(R) Core(TM) Ultra 7 155H', 'GPU': 'Intel(R) Arc(TM) Graphics (iGPU)', 'NPU': 'Intel(R) AI Boost'}, 'openvino': '2025.3.0-19807-44526285f24-releases/2025/3', 'os': 'Windows-11-10.0.26300-SP0'}

60 frames (30 per video from 0s at 2.0 fps), on-pitch people (score >= 0.5) and ball (>= 0.3). Agreement = same detections as the PyTorch CPU reference.

| Runtime | Tiles | Status | ms/frame mean / p95 | Drift | People/frame | Ball frames | Agreement IoU0.5 (miss/extra) | Agreement IoU0.9 | Ball agreement (miss/extra) | RSS MB | GPU MB | 90-min match at 2 fps (min) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| torch-cpu | 1 | OK | 281.3 / 291.4 | 1.006 | 4.93 | 2 | reference |  |  | 1067 |  | 51 |
| CPU | 1 | OK | 203.4 / 216.6 | 0.983 | 4.93 | 2 | 1.0 (0/0) | 1.0 | 2 (0/0) | 1313 |  | 37 |
| GPU | 1 | OK | 104.8 / 107.8 | 0.743 | 4.93 | 2 | 1.0 (0/0) | 1.0 | 2 (0/0) | 2187 |  | 19 |
| GPU-FP16 | 1 | OK | 83.0 / 90.8 | 0.738 | 4.9 | 2 | 0.9866 (4/2) | 0.9866 | 2 (0/0) | 2165 |  | 15 |
| NPU | 1 | UNAVAILABLE (fell back to the CPU) |  /  |  |  |  |  |  |  |  |  |  |
| torch-cpu | 2 | OK | 1057.6 / 1101.1 | 0.992 | 8.4 | 22 | reference |  |  | 2313 |  | 190 |
| CPU | 2 | OK | 896.9 / 993.7 | 0.995 | 8.4 | 22 | 1.0 (0/0) | 1.0 | 42 (0/0) | 3050 |  | 161 |
| GPU | 2 | OK | 462.1 / 543.9 | 0.834 | 8.4 | 22 | 1.0 (0/0) | 1.0 | 42 (0/0) | 3842 |  | 83 |
| GPU-FP16 | 2 | OK | 307.6 / 339.2 | 0.867 | 8.35 | 22 | 0.9908 (5/2) | 0.989 | 41 (1/1) | 3816 |  | 55 |
| NPU | 2 | UNAVAILABLE (fell back to the CPU) |  /  |  |  |  |  |  |  |  |  |  |
