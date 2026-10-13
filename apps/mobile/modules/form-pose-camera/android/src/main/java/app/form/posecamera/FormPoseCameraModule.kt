package app.form.posecamera

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class FormPoseCameraModule : Module() {
    override fun definition() = ModuleDefinition {
        Name("FormPoseCamera")

        // Gives requireOptionalNativeModule('FormPoseCamera') something to return, so JS can
        // tell "native pose camera present" from "absent" without touching the view.
        Constants("apiVersion" to 1)

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
