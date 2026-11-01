let darkOverlayCount = 0;

function setAndroidOverlayMode(enabled: boolean) {
  try {
    const bridge = (window as unknown as Record<string, unknown>).AndroidPrabawa as
      | { setOverlayMode?: (active: boolean) => void }
      | undefined;
    bridge?.setOverlayMode?.(enabled);
  } catch {
    // Not running in the Android WebView.
  }
}

export function acquireAndroidDarkSystemBars() {
  darkOverlayCount += 1;
  setAndroidOverlayMode(true);

  let released = false;
  return () => {
    if (released) return;
    released = true;
    darkOverlayCount = Math.max(0, darkOverlayCount - 1);
    if (darkOverlayCount === 0) setAndroidOverlayMode(false);
  };
}