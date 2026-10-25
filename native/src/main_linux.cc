#include "include/cef_app.h"
#include "include/cef_command_line.h"
#include "app.h"
#include "util.h"

// Last: Xlib defines macros (e.g. Success) that clash with CEF headers.
#include <X11/Xlib.h>

namespace {
int XErrorHandlerImpl(Display*, XErrorEvent*) { return 0; }
int XIOErrorHandlerImpl(Display*) { return 0; }
}  // namespace

int main(int argc, char* argv[]) {
  CefMainArgs main_args(argc, argv);
  CefRefPtr<sift::SiftApp> app = new sift::SiftApp();

  const int exit_code = CefExecuteProcess(main_args, app, nullptr);
  if (exit_code >= 0) return exit_code;

  // X11 errors from Chromium's own windows must not kill the browser.
  XSetErrorHandler(XErrorHandlerImpl);
  XSetIOErrorHandler(XIOErrorHandlerImpl);

  CefRefPtr<CefCommandLine> command_line = CefCommandLine::CreateCommandLine();
  command_line->InitFromArgv(argc, argv);

  CefSettings settings;
  settings.no_sandbox = command_line->HasSwitch("no-sandbox");
  const std::string root = sift::UserDataRoot();
  sift::MakeDirs(sift::ProfileDir("Default"));
  CefString(&settings.root_cache_path) = root;
  CefString(&settings.cache_path) = sift::ProfileDir("Default");
  settings.persist_session_cookies = true;
  CefString(&settings.user_agent_product) = "Sift/0.1";
  settings.log_severity = command_line->HasSwitch("verbose") ? LOGSEVERITY_INFO : LOGSEVERITY_WARNING;

  if (!CefInitialize(main_args, settings, app, nullptr)) return CefGetExitCode();
  CefRunMessageLoop();
  CefShutdown();
  return 0;
}
