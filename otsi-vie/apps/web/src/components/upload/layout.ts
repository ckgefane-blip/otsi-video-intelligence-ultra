/**
 * Page 02 layout numbers shared by the server-rendered page and the client sections (a plain module: a constant exported from a "use client"
 * file reaches the server as a placeholder, not as its value).
 *
 * RIGHT_EXTRA: design pixels the right column is taller than the approved reference. The five Recent Uploads boxes each gain RIGHT_EXTRA / 5 so
 * their fields (title, date, one line per running job) have room instead of being squeezed; the Selected Item Preview moves down by the same amount
 * and the stage grows with it. Every other page keeps the reference's height.
 */
export const RIGHT_EXTRA = 80;

/**
 * PIPE_EXTRA: the Processing Pipeline box grows downward until it ends level with the Selected Item Preview on the right
 * (that panel ends at design y 1418 + RIGHT_EXTRA; the pipeline box ended at 1426): the Live Processing Preview row below the five stages gets the room.
 */
export const PIPE_EXTRA = 1418 + RIGHT_EXTRA - 1426;
