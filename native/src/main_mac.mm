#import <Cocoa/Cocoa.h>

#include "include/cef_app.h"
#include "include/cef_application_mac.h"
#include "include/wrapper/cef_library_loader.h"
#include "app.h"
#include "util.h"

// NSApplication subclass required by CEF on macOS.
@interface SiftApplication : NSApplication <CefAppProtocol> {
 @private
  BOOL handlingSendEvent_;
}
@end

@implementation SiftApplication
- (BOOL)isHandlingSendEvent {
  return handlingSendEvent_;
}
- (void)setHandlingSendEvent:(BOOL)handlingSendEvent {
  handlingSendEvent_ = handlingSendEvent;
}
- (void)sendEvent:(NSEvent*)event {
  CefScopedSendingEvent sendingEventScoper;
  [super sendEvent:event];
}
// Cmd+Q: close every window through its normal path (so browsers shut down
// cleanly); the message loop quits when the last window is destroyed.
- (void)terminate:(id)sender {
  NSArray* windows = [[self windows] copy];
  for (NSWindow* window in windows) [window performClose:nil];
  if ([[self windows] count] == 0) CefQuitMessageLoop();
}
@end

// The menu bar: an app menu and an Edit menu. Without the Edit menu's
// standard selectors, Cmd+C/V/X/A don't reach text fields on macOS.
static void BuildMainMenu() {
  NSMenu* bar = [[NSMenu alloc] init];

  NSMenuItem* appItem = [[NSMenuItem alloc] init];
  [bar addItem:appItem];
  NSMenu* appMenu = [[NSMenu alloc] init];
  [appMenu addItemWithTitle:@"Hide Sift" action:@selector(hide:) keyEquivalent:@"h"];
  NSMenuItem* hideOthers = [appMenu addItemWithTitle:@"Hide Others"
                                              action:@selector(hideOtherApplications:)
                                       keyEquivalent:@"h"];
  [hideOthers setKeyEquivalentModifierMask:NSEventModifierFlagOption | NSEventModifierFlagCommand];
  [appMenu addItem:[NSMenuItem separatorItem]];
  [appMenu addItemWithTitle:@"Quit Sift" action:@selector(terminate:) keyEquivalent:@"q"];
  [appItem setSubmenu:appMenu];

  NSMenuItem* editItem = [[NSMenuItem alloc] init];
  [bar addItem:editItem];
  NSMenu* editMenu = [[NSMenu alloc] initWithTitle:@"Edit"];
  [editMenu addItemWithTitle:@"Undo" action:@selector(undo:) keyEquivalent:@"z"];
  [editMenu addItemWithTitle:@"Redo" action:@selector(redo:) keyEquivalent:@"Z"];
  [editMenu addItem:[NSMenuItem separatorItem]];
  [editMenu addItemWithTitle:@"Cut" action:@selector(cut:) keyEquivalent:@"x"];
  [editMenu addItemWithTitle:@"Copy" action:@selector(copy:) keyEquivalent:@"c"];
  [editMenu addItemWithTitle:@"Paste" action:@selector(paste:) keyEquivalent:@"v"];
  [editMenu addItemWithTitle:@"Select All" action:@selector(selectAll:) keyEquivalent:@"a"];
  [editItem setSubmenu:editMenu];

  [NSApp setMainMenu:bar];
}

int main(int argc, char* argv[]) {
  CefScopedLibraryLoader library_loader;
  if (!library_loader.LoadInMain()) return 1;

  CefMainArgs main_args(argc, argv);
  @autoreleasepool {
    [SiftApplication sharedApplication];
    BuildMainMenu();
    CefRefPtr<sift::SiftApp> app = new sift::SiftApp();

    CefSettings settings;
    settings.no_sandbox = true;
    const std::string root = sift::UserDataRoot();
    sift::MakeDirs(sift::ProfileDir("Default"));
    CefString(&settings.root_cache_path) = root;
    CefString(&settings.cache_path) = sift::ProfileDir("Default");
    settings.persist_session_cookies = true;
    CefString(&settings.user_agent_product) = "Sift/0.1";

    if (!CefInitialize(main_args, settings, app, nullptr)) return CefGetExitCode();
    CefRunMessageLoop();
    CefShutdown();
  }
  return 0;
}
