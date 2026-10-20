package app.form.posecamera

import app.form.posecamera.engine.ModelStore
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class FormPoseCameraModule : Module() {
    override fun definition() = ModuleDefinition {
        Name("FormPoseCamera")

        // Gives requireOptionalNativeModule('FormPoseCamera') something to return, so JS can
        // tell "native pose camera present" from "absent" without touching the view.
        Constants("apiVersion" to 1)

        // Downloads the pose models ahead of the first camera open (no UI). Resolves true when the full
        // model is on disk, false on any problem; it never rejects. Runs on its own thread because a
        // download blocks. An app build without this function simply never prefetches (JS checks).
        AsyncFunction("prefetchModels") { fullUrl: String, liteUrl: String?, promise: Promise ->
            val ctx = appContext.reactContext
            if (ctx == null) {
                promise.resolve(false)
            } else {
                val worker = Thread(
                    {
                        val ok = try {
                            ModelStore(ctx).prefetch(fullUrl, liteUrl)
                        } catch (ignored: Throwable) {
                            false
                        }
                        promise.resolve(ok)
                    },
                    "form-pose-prefetch",
                )
                worker.isDaemon = true
                worker.start()
            }
        }

        View(FormPoseCameraView::class) {
            Events("onCamera", "onPose", "onFrame", "onDiag")

            // Every setter only stores. applyProps() applies the whole batch once, in
            // OnViewDidUpdateProps, so a multi-prop update restarts the session at most once.
            Prop("active") { view, v: Boolean? -> view.active = v ?: false }
            Prop("facing") { view, v: String? -> view.facing = v ?: "front" }
            Prop("modelUrl") { view, v: String? -> view.modelUrl = v ?: "" }
            Prop("liteModelUrl") { view, v: String? -> view.liteModelUrl = v }
            Prop("confidence") { view, v: FloatArray? ->
                view.confidence = v ?: floatArrayOf(0.5f, 0.5f, 0.5f)
            }
            Prop("budgetMs") { view, v: Int? -> view.budgetMs = v ?: 32 }
            Prop("overlayMode") { view, v: String? -> view.overlayMode = v ?: "outline" }
            Prop("tone") { view, v: String? -> view.tone = v ?: "good" }
            Prop("chain") { view, v: IntArray? -> view.chain = v ?: IntArray(0) }
            Prop("palette") { view, v: PaletteProp? -> view.palette = v ?: PaletteProp() }
            Prop("reduceMotion") { view, v: Boolean? -> view.reduceMotion = v ?: false }
            Prop("maskEnabled") { view, v: Boolean? -> view.maskEnabled = v ?: true }
            Prop("leadMs") { view, v: Int? -> view.leadMs = v ?: 60 }
            Prop("diagnostics") { view, v: Boolean? -> view.diagnostics = v ?: false }

            OnViewDidUpdateProps { view -> view.applyProps() }

            OnViewDestroys { view -> view.cleanup() }
        }
    }
}
