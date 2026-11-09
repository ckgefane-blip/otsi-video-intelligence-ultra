# 07 · Audio

## 7.1 The audio model

- Audio clips sit on **audio tracks** below the video tracks. A video clip's own sound is *linked* until **Detach Audio** (Ctrl+Alt+D) splits it out onto its own track.
- Each audio clip has an **Audio tab** in the inspector, built from switchable sections:

| Section | Controls | Technique |
|---|---|---|
| Basic / adjustment | volume, **channels** (L/R handling), balance, **pitch** (without changing speed), fade in and out (seconds) | gain, pan, a pitch-shift DSP (phase vocoder / PSOLA) |
| Equalizer | presets, plus a band editor (*Setting* / *Customize*) | 3-band and 10-band EQ DSP blocks |
| **Auto normalisation** | platform presets, or a custom target of −23…−10 **LUFS** | integrated-loudness measurement (ITU-R BS.1770), then gain |
| **Audio ducking** | on the *primary* (voice) clip: duck level, fade position, fade duration | voice-activity detection drives a side-chain gain on the other tracks |
| Denoise | modes: **AI speech enhancement**, wind removal, normal denoise, **de-reverb**, hum removal, hiss removal | a dedicated model or DSP per noise type (see 01 §1.7) |
| AI voice enhancer | quick mode (beautify, clarity) and an enhanced mode | speech-enhancement network |
| AI vocal remover | **fast** (one vocal stem) or **detailed** (several vocal stems) | music source separation |
| Voice filters and characters | presets with a strength slider | DSP chains |

- **Timeline gestures on audio:**
  - drag **fade handles** at the top corners of the waveform (the further the drag, the longer the fade);
  - drag the edges to trim; use trim start/end to the playhead, split and mute;
  - Alt+click adds **volume keyframes** on the waveform line.
- **Clip-level tools (dialogs):**
  - **Audio gain:** a fixed ±dB change, or *normalise maximum peak*, applied to many selected clips at once.
  - **Audio stretch:** drag the clip end and the music is re-timed to the new length without pitch change.
  - **Auto synchronisation:** select a camera clip and a separate recorder clip; their **waveforms are cross-correlated** and the clips aligned. If they don't match, it says so plainly.
  - **Beat detection** and **silence detection** (see 06 §6.1).

## 7.2 Mixing and metering

- An **audio mixer** window shows a fader and a balance knob per track, **stereo or surround** panning (front and back placement), and preview before *Apply*.
- An **audio meter** next to the timeline gives live L/R dB bars with a peak warning.
- The **Audio-mixing workspace layout** brings Basic, Denoise, Voice filters and Voice characters together.
- A **VST3 host** loads third-party plug-ins and opens their own windows. The edit can also export as audio only (MP3 and others).
- **Audio remix mode** (S / Shift+S) is a timeline mode for re-arranging music. The shortcut map shows it exists.

## 7.3 Audio as a driver of video

- **Audio-driven effects:** a glitch, flash, zoom or colour-shift effect placed on a track *reacts to the music's amplitude*. A **sensitivity** slider sets how strongly, and a mask limits it to an area.
- **Audio visualiser:** a spectrum or waveform graphic with song-title and artist text, and a background blur.
- **Beat markers** become **snap points** for cuts, and *Auto Beat Sync* cuts the clips to them.

## 7.4 Lessons for OTSI

1. **Loudness by target (LUFS), not by guess.** Our reels mix match audio with music. One *normalise to −14 LUFS* step at render (ffmpeg `loudnorm`, free) makes every reel sound professional on any platform.
2. **Ducking.** Lower the music under commentary or crowd at key moments. It is a single ffmpeg `sidechaincompress` filter driven by the match-audio track. It is cheap and makes a big difference.
3. **Beat markers as snap points** for the reel cuts (`librosa`, ISC licence) turn "cuts on the beat" into a snap behaviour rather than an AI black box.
4. **Fade handles on the clip itself** are the most discoverable audio control there is. Our Clip Studio should draw them.
5. **Separation is a pro feature, not needed now.** Crowd/commentary separation would let a user mute the commentator. Open models exist (Demucs, MIT), but it is heavy and should come later.
6. **Honesty in failure:** "the selected clips cannot be synchronised" is the right tone for any automatic tool that gives up.
