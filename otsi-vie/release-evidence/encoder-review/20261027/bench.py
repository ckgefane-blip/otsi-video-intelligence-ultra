"""Encode the same 10 s of real 1080p football with each candidate H.264 encoder; time, size, PSNR vs the decoded source, stream facts."""
import sys, time, json, av, numpy as np
src, out = sys.argv[1], sys.argv[2]
N = 300
frames = []
with av.open(src) as c:
    for f in c.decode(video=0):
        frames.append(f.to_ndarray(format="yuv420p")); 
        if len(frames) >= N: break
h, w = frames[0].shape[0] * 2 // 3, frames[0].shape[1]
res = {}
for name, opts in [("libx264", {"preset": "medium", "crf": "20"}), ("libx264", {"preset": "veryfast", "crf": "20"}),
                   ("h264_mf", {"hw_encoding": "1", "rate_control": "quality", "quality": "70"}),
                   ("h264_mf", {"hw_encoding": "1", "rate_control": "cbr"}),
                   ("hevc_mf", {"hw_encoding": "1", "rate_control": "quality", "quality": "70"}),
                   ("h264_mf", {"hw_encoding": "0", "rate_control": "quality", "quality": "70"})]:
    key = f"{name} {json.dumps(opts)}"
    path = f"{out}/{name}_{abs(hash(key))%10000}.mp4"
    try:
        with av.open(path, "w") as o:
            s = o.add_stream(name, rate=30)
            s.width, s.height, s.pix_fmt = w, h, "nv12" if name.endswith("_mf") else "yuv420p"
            if "cbr" in opts.get("rate_control", ""): s.bit_rate = 12_000_000
            s.options = opts
            t = time.perf_counter()
            for i, a in enumerate(frames):
                vf = av.VideoFrame.from_ndarray(a, format="yuv420p")
                if s.pix_fmt == "nv12": vf = vf.reformat(format="nv12")
                vf.pts = i; vf.time_base = __import__("fractions").Fraction(1, 30)
                for p in s.encode(vf): o.mux(p)
            for p in s.encode(): o.mux(p)
            dt = time.perf_counter() - t
        psnr, info = [], {}
        with av.open(path) as c:
            v = c.streams.video[0]
            info = {"codec": v.codec_context.name, "profile": v.codec_context.profile, "pix_fmt": v.codec_context.pix_fmt, "w": v.width, "h": v.height}
            for i, f in enumerate(c.decode(v)):
                a = f.to_ndarray(format="yuv420p")[:h].astype(np.float32); b = frames[i][:h].astype(np.float32)
                mse = float(np.mean((a - b) ** 2)); psnr.append(99 if mse == 0 else 10 * np.log10(255 ** 2 / mse))
        import os
        res[key] = {"fps": round(N / dt, 1), "mbit_s": round(os.path.getsize(path) * 8 / (N / 30) / 1e6, 2), "psnr_y": round(float(np.mean(psnr)), 2), "frames": len(psnr), **info}
    except Exception as e:
        res[key] = {"error": f"{type(e).__name__}: {e}"}
    print(key, res[key], flush=True)
json.dump(res, open(f"{out}/bench.json", "w"), indent=1)
