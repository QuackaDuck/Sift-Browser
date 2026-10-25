// macOS window styling: a standard titled window whose title bar is
// transparent and overlaps the content, so Sift's tab row sits in the title
// bar beside the native traffic lights (like Safari).
#import <Cocoa/Cocoa.h>

#include "window.h"

namespace sift {

void ConfigureNativeWindow(CefRefPtr<CefWindow> window) {
  NSView* view = (NSView*)window->GetWindowHandle();  // cef_window_handle_t is an NSView* on macOS
  NSWindow* nswindow = [view window];
  if (!nswindow) return;
  nswindow.styleMask |= NSWindowStyleMaskFullSizeContentView;
  nswindow.titlebarAppearsTransparent = YES;
  nswindow.titleVisibility = NSWindowTitleHidden;
  // An empty compact toolbar makes the title bar as tall as the tab row, which
  // vertically centres the traffic lights on it.
  NSToolbar* toolbar = [[NSToolbar alloc] initWithIdentifier:@"app.sift.titlebar"];
  toolbar.showsBaselineSeparator = NO;
  nswindow.toolbar = toolbar;
  nswindow.toolbarStyle = NSWindowToolbarStyleUnifiedCompact;
}

}  // namespace sift
