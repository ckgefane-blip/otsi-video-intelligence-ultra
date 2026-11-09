# 10 · Export, delivery and cloud

## 10.1 The export window

One modal window with **destination tabs**:

- **Local:** a format list (MP4, MOV, MKV, AVI, WMV, GIF, MP3, ProRes …).
- **Device:** presets for phones, tablets, consoles and TV.
- **Social:** YouTube, TikTok, Vimeo and others, with direct upload after OAuth login. Title, description, tags, privacy, category, and an optional **schedule**.
- **DVD** (disc, folder or ISO).
- **XML:** the timeline for another NLE.
- Plus **batch export** and **Live Photo**.

The **Local** tab shows:

- name, save location;
- the format;
- a summary of **resolution, frame rate, size estimate and duration**;
- **Settings** for quality presets, bitrate, encoder, **export colour space** (SDR or HDR, greyed out with an explanation when GPU acceleration is off) and **hardware-accelerated encoding**;
- an **AI copywriting** button next to the name (title and description);
- a **thumbnail** with *Edit*, which opens the AI thumbnail picker or a local image with templates;
- switches that **change the output**:
  - **Auto highlight:** auto, 15 s or 60 s vertical, or a custom length;
  - **Auto reframe:** a target ratio;
  - **Include chapters:** chapter editor, styled progress bar, custom playhead;
  - **Compression:** by quality, or a platform-recommended bitrate;
- **Upload to cloud** on export;
- a preview and a **progress** display. The job can run while the user keeps working, and the Transfer Center shows uploads.

## 10.2 Partial exports

- **Export selected clips** (right-click): only those clips.
- **Export clip range:** set I/O in the player, then export only that range.
- **Export current timeline:** a timeline tab (for example a compound clip's inside).
- **Multi-track export:** MP4/MOV with up to 10 separate audio tracks, for later mixing.
- **Snapshot** for a single frame; **export subtitle file** (SRT) for captions.

## 10.3 Cloud and sharing (vendor services)

- 1 GB of free cloud storage when signed in, for projects (including packaged bundles), templates and finished videos.
- **Share links:**
  - optional auto-generated 4-character access code;
  - **expiry** (1 day, 7 days, 30 days or never);
  - **permissions** (download, comment).
- **Review comments** pinned to an *exact time* in the video, or to the whole video. Invited reviewers comment through the link.
- Shared-files list, recycle bin and transfer centre; the same media from mobile and desktop.
- Import directly from third-party drives after OAuth.

## 10.4 Licence gating

Every feature works unsigned **except that exports carry a watermark** until the user signs in with a paid licence. Stock items carry a premium badge, and AI generation costs credits that are shown before running.

## 10.5 Lessons for OTSI

1. **The export window is where intent becomes policy.** Ours must enforce **rights and identity gates**:
   - an *unverified identity* reel cannot be *delivered*;
   - produce rights and export/delivery rights are separate (CLAUDE.md §3).
   The window is also where we show *why* a destination is greyed out, as Filmora does for HDR ("needs GPU acceleration"). That is the Rights block of Phase A.11.
2. **Show the size estimate, duration and resolution summary before encoding.** It is cheap and stops surprises.
3. **Output-changing switches at export** (auto reframe 9:16, auto highlight 30/60 s, chapters) let *one* edit produce *many* deliverables. A club wants the same player reel in 16:9 for the scout and 9:16 for social.
4. **Time-coded review comments with expiring, permissioned share links** describe a club → agent → scout review loop exactly. We already have share/delivery rights in the data model. The *comment at a timecode* is the missing UX.
5. **Export a range or the selected clips** maps to "download this moment" (the fast stream-copy path, see 03 §3.4).
6. **Background export with a transfer centre.** Our job tray is the same idea, and Filmora confirms users expect to keep working while a render runs.
7. **Watermark until entitled** is a clean, honest entitlement pattern: everything is usable, and delivery quality is what is gated. It suits our produce vs delivery rights split. (Our pricing is the owner's decision; this is only a pattern.)
