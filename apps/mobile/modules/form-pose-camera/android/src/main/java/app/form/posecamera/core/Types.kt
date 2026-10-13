package app.form.posecamera.core

/** Quality rungs, best first. A and B run the segmentation mask; C and D do not. */
enum class Rung {
    FULL_MASK,
    LITE_MASK,
    LITE_CAPSULE,
    LITE_JOINTS;

    /** True for the rungs that produce a segmentation mask. */
    val hasMask: Boolean
        get() = this == FULL_MASK || this == LITE_MASK

    /** The next worse rung, or null at the bottom of the ladder. */
    fun worse(): Rung? = when (this) {
        FULL_MASK -> LITE_MASK
        LITE_MASK -> LITE_CAPSULE
        LITE_CAPSULE -> LITE_JOINTS
        LITE_JOINTS -> null
    }

    /** The next better rung, or null at the top of the ladder. */
    fun better(): Rung? = when (this) {
        FULL_MASK -> null
        LITE_MASK -> FULL_MASK
        LITE_CAPSULE -> LITE_MASK
        LITE_JOINTS -> LITE_CAPSULE
    }
}

enum class Tone { GOOD, FIX, WARN, UNTRACKABLE }

enum class OverlayMode { OUTLINE, JOINTS, OFF }

/** Opaque ARGB colours (see parseHex). */
class Palette(
    val good: Int,
    val fix: Int,
    val warn: Int,
    val untrackable: Int,
    val other: Int,
    val halo: Int,
    val highlight: Int,
)

class OverlayStyle(
    val mode: OverlayMode,
    val tone: Tone,
    val chain: IntArray,
    val palette: Palette,
    val reduceMotion: Boolean,
    val leadMs: Int,
)

/** Segmentation mask grid: values 0..1, row-major, covering the normalized visible region. */
class MaskGrid(val gw: Int, val gh: Int, val v: FloatArray)

class PoseFrameResult(
    /** Strictly increasing, sensor-clock ms. */
    val tsMs: Long,
    /** SystemClock.elapsedRealtimeNanos base. */
    val captureNs: Long,
    val arrivedNs: Long,
    val regionW: Int,
    val regionH: Int,
    /** Null = nobody; else 99 floats ([x, y, visibility] x 33). */
    val landmarks: FloatArray?,
    /** Downsampled by the engine; null when none. */
    val mask: MaskGrid?,
    val inferMs: Float,
    /** Mean luma 0..255 of the visible region, sampled every 500 ms and carried between samples; -1 = unknown. */
    val brightness: Float = -1f,
)
