# 03 · Projects, media and import

Source: the public Filmora 16 user guide (Windows) and hands-on observation of the installed 16.0.12 build.
Written in our own words. No code, assets or text are copied.

## 3.1 The project model

| Idea | How Filmora does it | Why it matters |
|---|---|---|
| Project file | One `.wfp` file holds the edit decisions: sequence settings, timeline, effects, music and keyframes. | The project is a *recipe*, not media. It stays small. |
| Media by reference | The project stores file names and paths, never the source media. A moved or renamed file shows as *missing*. | Saving is cheap, but the project breaks when files move, so a relink flow is needed. |
| Relink | Right-click the missing item, choose **Relink Media**, then pick the new folder. Edits are kept. | Repairs the reference without redoing any edits. |
| Archive project | **File → Archive Project** (Ctrl+Shift+A) writes the project plus every used media file into one package (`.wfpbundle`). | Makes the project portable, a full backup and safe from missing files. |
| Project settings | Aspect ratio, resolution, frame rate, colour space, *high-precision processing* and audio sample rate. Set at creation from the start-screen aspect picker, and editable later. | The sequence format is chosen first; clips adapt to it. |
| Subprojects | **Import Subprojects** loads another `.wfp` or `.wfpbundle` into a media folder. Its timeline arrives as a *compound clip*, which can be opened, edited or detached. Missing media is checked on import. | Projects nest inside projects: reuse and team splitting. |
| Open, recent, cloud | Ctrl+O, Open Recent, and projects backed up to the vendor cloud appear on the start screen. | |
| Autosave and backup | Preferences hold the autosave interval and the backup location (seen in Preferences). | Protects against crashes. |

**Technique.** This is the classic non-linear editor (NLE) design: an *edit decision list* that points to immutable source media. Rendering is a pure function of (EDL, media). Everything else follows from this: proxies, relinking, archiving, nested sequences.

## 3.2 Ways media comes in

1. **File → Import Media.** Files, a whole folder, a camera or phone, *Import with Auto Beat Sync*, *Import with Instant Cutter* and *Import Timeline XML* (an interchange format for edits from other NLEs).
2. **The Import button** next to Project Media, or drag and drop onto the media bin.
3. **Scan to Import.** A QR code pairs a phone, and clips sent from the phone appear in the bin.
4. **Image sequence.** Numbered stills (JPEG) are joined into one clip when the first frame is chosen with *Image Sequence* ticked.
5. **Record.** Screen, webcam and voice-over recorders write straight into the bin.
6. **Subprojects**, as in §3.1.

On a high-resolution import the app *offers* a proxy (see 01-technology §1.5). It suggests the proxy; it does not force one.

## 3.3 The Media panel (left zone): an information architecture

The left zone is a two-level browser. A **category tab strip** sits on top: Media, Stock Media, Audio, Titles, Transitions, Effects, Stickers, Templates. Each category has a **tree** on the left and a **grid** on the right.

Under *Media* the tree is:

- **Project Media**: the files of this project. Folders and subfolders can be created, renamed, moved between and imported as whole folders.
- **Smart Media Bin**: a *saved query*. It has a name, a match rule (*All* or *Any*), and a list of conditions such as "file name contains …". Matching media fills the bin automatically and nothing is moved.
- **Global Media**: assets shared by every project (logos, stings), so they need not be imported again.
- **Cloud Media**: vendor cloud storage, showing a quota and its expiry.
- **Editing Presets**: reusable *building blocks* rather than media: adjustment layer, solid colour layer, saved compound clips, and LUTs.
- **Influence Kit**: intro, outro and logo-reveal starters, plus "my files".
- **Media Analysis Results**: what the AI indexer found in the media (see 06-ai §6.1). Clips can be searched and sorted by content.
- **Stock Media**: favourites, downloads, AI-generated media, and the built-in library (backgrounds and loops in categories). Partner libraries can be searched in-app.

**Grid controls.** The ⋯ menu offers *View* (list or large/medium/small thumbnails), *Sort by* (name, duration, type, created, media created, imported) and *Group by* (type, date, camera name, duration …), each ascending or descending. Ctrl and Shift give multi-select.

**Media Info.** Selecting a clip opens Project Info and Media Info in the property area. These show the technical details, plus *tags*, a renamable display name and *comments*. User metadata lives on the media item.

### Lessons for OTSI

- Our media library is the engine's *moments*: goals, shots, duels and a player's touches. Filmora's **Smart Media Bin** is the right model for a *saved query bin*, for example "Player X · all touches in the final third". It is a filter, not a copy. It suits a scouting workflow well.
- **Media Analysis Results as a tree node** is the same idea as our engine output. AI findings are shown as a *browsable index* in the media panel, not on a separate page.
- **Global Media** (shared across projects) is our club branding kit: crest, sponsor board, outro.
- Relinking and archiving matter less to us, because our media lives on the server, but *missing source* still needs a visible state (Trash, deleted video).

## 3.4 Quick tools outside the editor

The **Instant Cutter** is a stripped-down, near-lossless trim and merge window. *Trim* sets in and out handles on a bar and exports. *Merge* joins files of the same codec, resolution and frame rate without re-encoding. It is for large action-cam files.

**Technique.** Cutting on keyframe (GOP) boundaries and remuxing, with no decode or encode. It is fast and lossless, but the cuts are only as precise as the GOP.

**Lesson.** A *fast clip export* (stream copy) is cheap to give the user for "download this moment raw" next to the full render.
