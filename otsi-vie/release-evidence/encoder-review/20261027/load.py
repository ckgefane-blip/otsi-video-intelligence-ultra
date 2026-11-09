import av, fractions, sys, time
hw = sys.argv[1]
f = av.VideoFrame.from_ndarray(__import__("numpy").random.randint(0,255,(1080*3//2,1920),dtype="uint8"), format="yuv420p").reformat(format="nv12")
t=time.time()
with av.open(f"D:/OTSI-Workspace/_tmp/enc/load{hw}.mp4","w") as o:
    s=o.add_stream("h264_mf",rate=30); s.width,s.height,s.pix_fmt=1920,1080,"nv12"; s.options={"hw_encoding":hw,"rate_control":"cbr"}; s.bit_rate=12_000_000
    i=0
    while time.time()-t<12:
        f.pts=i; f.time_base=fractions.Fraction(1,30); i+=1
        for k in s.encode(f): o.mux(k)
    for k in s.encode(): o.mux(k)
print("frames", i)
