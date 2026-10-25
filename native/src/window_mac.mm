// macOS window styling: a standard titled window whose title bar is
// transparent and overlaps the content, so Sift's tab row sits in the title
// bar beside the native traffic lights (like Safari).
//
// Built against the macOS 26 SDK, the system draws the window in the Liquid
// Glass design (traffic lights, corners, shadow). Sift's own title-bar
// metrics follow it on macOS 27 and later only; older releases keep the
// classic sizes.
#import <Cocoa/Cocoa.h>

#include <cmath>

#include "window.h"

namespace sift {

namespace {

NSWindow* NativeWindow(CefRefPtr<CefWindow> window) {
  NSView* view = (NSView*)window->GetWindowHandle();  // cef_window_handle_t is an NSView* on macOS
  return [view window];
}

}  // namespace

bool UsesLiquidGlassTitlebar() {
  static const bool glass = [[NSProcessInfo processInfo] operatingSystemVersion].majorVersion >= 27;
  return glass;
}

void ConfigureNativeWindow(CefRefPtr<CefWindow> window) {
  NSWindow* nswindow = NativeWindow(window);
  if (!nswindow) return;
  nswindow.styleMask |= NSWindowStyleMaskFullSizeContentView;
  nswindow.titlebarAppearsTransparent = YES;
  nswindow.titleVisibility = NSWindowTitleHidden;
  // The tab row is the title bar; no line under it.
  nswindow.titlebarSeparatorStyle = NSTitlebarSeparatorStyleNone;
}

int TrafficLightsRight(CefRefPtr<CefWindow> window) {
  NSWindow* nswindow = NativeWindow(window);
  NSButton* zoom = [nswindow standardWindowButton:NSWindowZoomButton];
  if (!zoom || !zoom.superview) return 0;
  const NSRect frame = [zoom.superview convertRect:zoom.frame toView:nil];
  return static_cast<int>(std::ceil(NSMaxX(frame)));
}

void MakeKeyWindowFor(CefWindowHandle handle) {
  NSView* view = (NSView*)handle;
  NSWindow* nswindow = [view window];
  if (nswindow && !nswindow.isKeyWindow && nswindow.canBecomeKeyWindow) [nswindow makeKeyWindow];
}

}  // namespace sift
