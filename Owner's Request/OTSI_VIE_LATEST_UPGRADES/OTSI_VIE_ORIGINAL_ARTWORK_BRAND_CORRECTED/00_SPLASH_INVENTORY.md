# OTSI VIE — 00 Splash — Visual Inventory

**Reference:** Exact user-supplied 1672 × 941 (16:9) onboarding image, preserved as the screen background. **Brand correction:** mock wordmark replaced by the supplied OTSI(3).png blue/green emblem and white OTSI lettering, complemented with blue VIE.

## Screen specification
- Desktop/web onboarding. Source artwork 1672 × 941; scales proportionally to the viewport preserving aspect ratio; designed to fill a QHD 2560 × 1440 workspace at 16:9.
- Stadium environment, football visualizations, panels, headlines, decorative overlays, shadows and illustrated content are **embedded pixels in the supplied reference image**, not separately editable HTML nodes. No source CSS font or individual rectangle measurements can be proven from the raster beyond observed pixel positions.
- Branding replacement uses the attached source logo artwork rather than the mock typography. The image was edited in the brand region; unrelated main artwork retained.
- Page background: #000b18; central image fills its 1672:941 stage without stretching.

## Controls present
- All visually drawn buttons and dots are part of the image and remain visible with their exact reference appearance.
- Transparent focusable HTML links overlay the visible control positions to make navigation possible. Keyboard focus creates a #33a8ff outline.
- **Splash image: click anywhere to start the tour.**

## Backend/DB source (brief)
- No database query, inference, video processing or tracking data is required to display this visual onboarding screen.
- Production application should store onboarding completion/skip state in account preferences or local session storage; the included HTML demo does not store it.
- The generated image depicts visual examples only: any player stats, names and performance numbers shown in the image are illustrative, not verified data.

## Fidelity and implementation limitation
- The original screenshot is retained rather than redesigned. The branding area has been replaced to show the supplied real OTSI logo.
- This is an image-backed HTML prototype as requested, not a DOM reconstruction of every internal illustrated panel. If editable individual cards are required, those elements must be separately rebuilt with source CSS/components.
