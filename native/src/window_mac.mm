// macOS window styling: a standard titled window whose title bar is
// transparent and overlaps the content, so Sift's tab row sits in the title
// bar beside the native traffic lights (like Safari).
//
// Built against the macOS 26 SDK, the system draws the window in the Liquid
// Glass design (traffic lights, corners, shadow). Sift's own title-bar
// metrics follow it on macOS 27 and later only; older releases keep the
// classic sizes.
#import <Cocoa/Cocoa.h>

#include <algorithm>
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

namespace {

// Vertical centre of the close button, from the top of the window, in points.
CGFloat CloseButtonCenter(NSWindow* nswindow) {
  NSButton* close = [nswindow standardWindowButton:NSWindowCloseButton];
  if (!close || !close.superview) return -1;
  const NSRect frame = [close convertRect:close.bounds toView:nil];
  return nswindow.frame.size.height - NSMidY(frame);
}

}  // namespace

void AlignTrafficLights(CefRefPtr<CefWindow> window, float center, float* titlebar_height) {
  NSWindow* nswindow = NativeWindow(window);
  if (!nswindow) return;
  // AppKit reads the title bar height only when it lays out the window frame,
  // which a size change triggers; nudge the width by a point and back.
  auto relayout = [nswindow]() {
    const NSRect frame = nswindow.frame;
    [nswindow setFrame:NSMakeRect(frame.origin.x, frame.origin.y, frame.size.width + 1, frame.size.height) display:NO];
    [nswindow setFrame:frame display:YES];
  };
  // Where AppKit puts the buttons within a title bar of a given height
  // differs between releases (Liquid Glass buttons sit lower), so measure
  // and correct rather than assume.
  for (int i = 0; i < 3; ++i) {
    const CGFloat actual = CloseButtonCenter(nswindow);
    NSLog(@"Sift: title bar %.1f, traffic lights at %.1f, tab row centre %.1f", *titlebar_height, actual, center);
    if (actual < 0 || std::fabs(actual - center) < 0.5) return;
    const float previous = *titlebar_height;
    *titlebar_height = std::max(16.0f, previous + 2 * static_cast<float>(center - actual));
    relayout();
    if (std::fabs(CloseButtonCenter(nswindow) - actual) < 0.25) {
      // The buttons didn't move; keep the height that was in effect.
      *titlebar_height = previous;
      relayout();
      return;
    }
  }
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
