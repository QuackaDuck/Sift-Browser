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
  auto relayout_with = [nswindow, titlebar_height](float height) {
    *titlebar_height = height;
    const NSRect frame = nswindow.frame;
    [nswindow setFrame:NSMakeRect(frame.origin.x, frame.origin.y, frame.size.width + 1, frame.size.height) display:NO];
    [nswindow setFrame:frame display:YES];
  };
  // Where AppKit puts the buttons within a title bar of a given height, and
  // how far they move when it changes, differ between releases (Liquid Glass
  // buttons follow the bottom of the title bar). Measure two heights and
  // solve, rather than assume.
  const float original = *titlebar_height;
  float height = original;
  CGFloat actual = CloseButtonCenter(nswindow);
  float prev_height = height;
  CGFloat prev_actual = actual;
  CGFloat slope = 0.5;  // a first guess: buttons centred in the title bar
  for (int i = 0; i < 4; ++i) {
    NSLog(@"Sift: title bar %.1f, traffic lights at %.1f, tab row centre %.1f", height, actual, center);
    if (actual < 0 || std::fabs(actual - center) < 0.5) break;
    if (i > 0) {
      if (std::fabs(actual - prev_actual) < 0.25 || height == prev_height) {
        // The buttons don't follow the height; keep the one that was in effect.
        relayout_with(original);
        return;
      }
      slope = (actual - prev_actual) / (height - prev_height);
    }
    prev_height = height;
    prev_actual = actual;
    height = std::clamp(static_cast<float>(height + (center - actual) / slope), 16.0f, 120.0f);
    relayout_with(height);
    actual = CloseButtonCenter(nswindow);
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
