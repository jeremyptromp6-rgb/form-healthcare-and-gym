package app.form.posecamera

import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import expo.modules.kotlin.types.OptimizedRecord

// Event payloads sent to JS. The field names are the contract in src/types.ts.
// A null field reaches JS as null (not undefined), which src/types.ts allows for.

/** `kind`: live | ended | error. `name` (error only) uses the WebView error names: NotAllowedError ... */
@OptimizedRecord
class CameraEvent(
    @Field val kind: String,
    @Field val name: String?,
) : Record

/** `kind`: loading | ready | failed | model. The other fields are set only for the kinds that use them. */
@OptimizedRecord
class PoseEvent(
    @Field val kind: String,
    @Field val stage: String?,
    @Field val pct: Int?,
    @Field val backend: String?,
    @Field val variant: String?,
    @Field val rung: String?,
    @Field val offline: Boolean?,
    @Field val message: String?,
    @Field val fatal: Boolean?,
) : Record

/** One frame. `lm` is empty when nobody is in view, else 99 floats [x, y, visibility] x 33. `b` is -1 when unknown. */
@OptimizedRecord
class FrameEvent(
    @Field val ts: Double,
    @Field val w: Int,
    @Field val h: Int,
    @Field val ms: Double,
    @Field val b: Double,
    @Field val lm: FloatArray,
) : Record

/** Preview-build diagnostics at 1 Hz. */
@OptimizedRecord
class DiagEvent(
    @Field val fps: Double,
    @Field val inferMs: Double,
    @Field val ageP50: Double,
    @Field val ageP95: Double,
    @Field val drawMs: Double,
    @Field val backend: String,
    @Field val variant: String,
    @Field val rung: String,
    @Field val mirrorX: Boolean,
    @Field val region: String,
    @Field val view: String,
    @Field val maskMs: Double,
    @Field val delegateNote: String,
) : Record

/** The `palette` prop: '#RRGGBB' strings, parsed with core.parseHex. */
class PaletteProp : Record {
    @Field var good: String = "#2ECC71"
    @Field var fix: String = "#F5A524"
    @Field var warn: String = "#E5484D"
    @Field var untrackable: String = "#9CA3AF"
    @Field var other: String = "#FFFFFF"
    @Field var halo: String = "#000000"
    @Field var highlight: String = "#FFFFFF"
}
