package com.alex.planner.web;

import android.os.Bundle;
import androidx.activity.EdgeToEdge;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        // Draw under the status and navigation bars like the native app; the page pads itself
        // with the safe-area insets (SystemBars insetsHandling "css").
        // After super: the bridge picks its no-action-bar theme first, before the window exists.
        super.onCreate(savedInstanceState);
        EdgeToEdge.enable(this);
    }
}
