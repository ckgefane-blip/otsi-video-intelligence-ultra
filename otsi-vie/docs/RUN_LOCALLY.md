# Run OTSI VIE v2 on this machine (real mode)

OTSI VIE starts **empty**: no sample players, matches, videos or results (ADR-020). Everything you see is what you create.

## What exists today
- Sign in, your organization and role, the ten approved pages with every section in place.
- Sections not built yet say **"Not connected · Block NN"**. They never show invented data.
- **Upload & Ingest**: create a project, upload a match video (or paste a link: "Which links work?" lists what can be imported,
  what needs your own access token and what is refused, with the alternative). The server verifies, scans and inspects the file.
- **Analyse**: select a verified video -> "Analyse this video" -> Start analysis. The AI Processing page shows the worker's real
  progress. On this machine (Intel Arc GPU) a 90-minute match at the default 2 analysed frames per second takes about 70-85 minutes.
- **Analysis Workspace**: the video with the detected people and ball, temporary track numbers, click a box to select it, and
  confirm who it is (find a player, or create one). A correction asks for a reason; nothing is overwritten.
- Reels, spotlight and MP4 export are being built next (see `docs/IMPLEMENTATION_STATUS.md`, "Owner acceptance journey").

## Requirements
Docker Desktop running, Node.js 22, the project virtualenv (`D:\OTSI-Workspace\VIE-Engine-v2\.venv`), and the project's own LGPL
FFmpeg build (once, about 15 minutes: `.venv\Scripts\python.exe otsi-vie\tools\ffmpeg\build_ffmpeg.py`; see `otsi-vie/tools/ffmpeg/README.md`).

## First time
From `D:\OTSI-Workspace\VIE-Engine-v2`:

1. Start the app (the first run creates the database container `otsi-vie-v2-mysql` on 127.0.0.1:3508 with its data in `.local\mysql-data`, applies the migrations, and builds everything):

   ```
   .venv\Scripts\python.exe otsi-vie\tools\dev\local_stack.py run
   ```

2. In a second terminal, create your organization and owner account once (you will be asked for a password of at least 12 characters):

   ```
   .venv\Scripts\python.exe otsi-vie\tools\dev\local_stack.py bootstrap-owner --email you@example.com --name "Your Name" --organization "Your Club"
   ```

3. Open http://127.0.0.1:4310 and sign in.

## Every other time
```
.venv\Scripts\python.exe otsi-vie\tools\dev\local_stack.py run
```
Ctrl+C stops the API, worker and web app. The database container keeps running in the background and keeps your data.

## Ports
Web app 4310, API 4520 (4300 is used by another program on this machine), database 3508. The existing MySQL on 3306 is never touched.

## Where things are kept
- Database: Docker container `otsi-vie-v2-mysql`, files in `D:\OTSI-Workspace\VIE-Engine-v2\.local\mysql-data`.
- Uploaded media (once uploads exist): `D:\OTSI-Workspace\VIE-Engine-v2\.local\stack\owner\storage`.
- Secrets (database password, token signing key): `D:\OTSI-Workspace\VIE-Engine-v2\.local\` — never committed.
