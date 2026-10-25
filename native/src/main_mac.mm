#import <Cocoa/Cocoa.h>

#include "include/cef_app.h"
#include "include/cef_application_mac.h"
#include "include/wrapper/cef_library_loader.h"
#include "app.h"
#include "util.h"

// Minimal NSApplication subclass required by CEF on macOS.
@interface SiftApplication : NSApplication <CefAppProtocol> {
 @private
  BOOL handlingSendEvent_;
}
@end

@implementation SiftApplication
- (BOOL)isHandlingSendEvent { return handlingSendEvent_; }
- (void)setHandlingSendEvent:(BOOL)handlingSendEvent { handlingSendEvent_ = handlingSendEvent; }
- (void)sendEvent:(NSEvent*)event {
  CefScopedSendingEvent sendingEventScoper;
  [super sendEvent:event];
}
- (void)terminate:(id)sender {
  CefQuitMessageLoop();
}
@end

int main(int argc, char* argv[]) {
  CefScopedLibraryLoader library_loader;
  if (!library_loader.LoadInMain()) return 1;

  CefMainArgs main_args(argc, argv);
  @autoreleasepool {
    [SiftApplication sharedApplication];
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
