package com.alex.planner.web.device

import android.content.Context
import android.graphics.Rect
import android.os.SystemClock
import android.util.AttributeSet
import android.view.ActionMode
import android.view.KeyEvent
import android.view.Menu
import android.view.MenuItem
import android.view.View
import com.getcapacitor.CapacitorWebView
import java.lang.ref.WeakReference

/**
 * The app's WebView (res/layout/capacitor_bridge_layout_main.xml puts it in place of Capacitor's own).
 * It only changes the text selection's floating toolbar (Cut / Copy / Paste):
 * - it sits right above the selection: the page reports where its selection is (SelectionToolbar.rect,
 *   from web/src/ui/phone/selectionBar.ts), and that is the place given to the toolbar;
 * - in text that can be edited (Paste is offered), Cut is there too when the WebView left it out.
 * Anything unexpected falls back to the WebView's own toolbar.
 */
class PlannerWebView(context: Context, attrs: AttributeSet) : CapacitorWebView(context, attrs) {
    override fun startActionMode(callback: ActionMode.Callback?, type: Int): ActionMode? {
        if (callback == null || type != ActionMode.TYPE_FLOATING) return super.startActionMode(callback, type)
        val wrapped = SelectionCallback(this, callback)
        val mode = try { super.startActionMode(wrapped, type) } catch (_: Throwable) { return super.startActionMode(callback, type) }
        SelectionToolbar.mode = WeakReference(mode)
        return mode
    }
}

/** Where the page's selection is (in this WebView's pixels), and the toolbar showing for it. */
object SelectionToolbar {
    @Volatile private var rect: Rect? = null
    @Volatile private var at = 0L
    @Volatile var mode: WeakReference<ActionMode?> = WeakReference(null)

    /** From the page: the selection's box, or null when there's no selection. */
    fun set(r: Rect?) {
        rect = r
        at = SystemClock.uptimeMillis()
    }

    /** The page's latest box, if it's recent enough to trust. */
    fun current(): Rect? {
        val r = rect ?: return null
        return if (SystemClock.uptimeMillis() - at < 5_000 && !r.isEmpty) Rect(r) else null
    }
}

private class SelectionCallback(private val view: View, private val inner: ActionMode.Callback) : ActionMode.Callback2() {
    private val cutId = View.generateViewId()

    override fun onCreateActionMode(mode: ActionMode, menu: Menu): Boolean {
        val ok = inner.onCreateActionMode(mode, menu)
        if (ok) addCut(menu)
        return ok
    }

    override fun onPrepareActionMode(mode: ActionMode, menu: Menu): Boolean {
        val changed = inner.onPrepareActionMode(mode, menu)
        return addCut(menu) || changed
    }

    override fun onActionItemClicked(mode: ActionMode, item: MenuItem): Boolean {
        if (item.itemId == cutId) {
            // Ctrl+X: the WebView cuts the selection itself (to the clipboard, as an undoable edit).
            val t = SystemClock.uptimeMillis()
            val meta = KeyEvent.META_CTRL_ON or KeyEvent.META_CTRL_LEFT_ON
            view.dispatchKeyEvent(KeyEvent(t, t, KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_X, 0, meta))
            view.dispatchKeyEvent(KeyEvent(t, t, KeyEvent.ACTION_UP, KeyEvent.KEYCODE_X, 0, meta))
            mode.finish()
            return true
        }
        return inner.onActionItemClicked(mode, item)
    }

    override fun onDestroyActionMode(mode: ActionMode) {
        inner.onDestroyActionMode(mode)
    }

    override fun onGetContentRect(mode: ActionMode, view: View, outRect: Rect) {
        if (inner is ActionMode.Callback2) inner.onGetContentRect(mode, view, outRect) else super.onGetContentRect(mode, view, outRect)
        SelectionToolbar.current()?.let { outRect.set(it) }
    }

    /** Adds Cut beside Copy when the text can be edited (Paste is there) and it's missing. True if added. */
    private fun addCut(menu: Menu): Boolean {
        try {
            val res = view.context
            val cut = res.getString(android.R.string.cut)
            val copy = res.getString(android.R.string.copy)
            val paste = res.getString(android.R.string.paste)
            var copyItem: MenuItem? = null
            var hasPaste = false
            for (i in 0 until menu.size()) {
                val it = menu.getItem(i)
                val title = it.title?.toString() ?: continue
                if (it.itemId == cutId || title.equals(cut, ignoreCase = true)) return false
                if (title.equals(copy, ignoreCase = true)) copyItem = it
                if (title.equals(paste, ignoreCase = true)) hasPaste = true
            }
            val c = copyItem ?: return false
            if (!hasPaste) return false
            menu.add(c.groupId, cutId, maxOf(0, c.order - 1), cut).setShowAsAction(MenuItem.SHOW_AS_ACTION_ALWAYS)
            return true
        } catch (_: Throwable) {
            return false
        }
    }
}
