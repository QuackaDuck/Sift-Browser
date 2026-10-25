#include <windows.h>

#include "include/cef_app.h"
#include "include/cef_command_line.h"
#include "app.h"
#include "util.h"

int APIENTRY wWinMain(HINSTANCE hInstance, HINSTANCE, LPTSTR, int) {
  CefMainArgs main_args(hInstance);
  CefRefPtr<sift::SiftApp> app = new sift::SiftApp();

  const int exit_code = CefExecuteProcess(main_args, app, nullptr);
  if (exit_code >= 0) return exit_code;

  CefRefPtr<CefCommandLine> command_line = CefCommandLine::CreateCommandLine();
  command_line->InitFromString(::GetCommandLineW());

  CefSettings settings;
  settings.no_sandbox = true;  // see docs/ARCHITECTURE.md: enable with cef_sandbox.lib for release builds
  const std::string root = sift::UserDataRoot();
  sift::MakeDirs(sift::ProfileDir("Default"));
  CefString(&settings.root_cache_path) = root;
  CefString(&settings.cache_path) = sift::ProfileDir("Default");
  settings.persist_session_cookies = true;
  CefString(&settings.user_agent_product) = "Sift/0.1";

  if (!CefInitialize(main_args, settings, app, nullptr)) return CefGetExitCode();
  CefRunMessageLoop();
  CefShutdown();
  return 0;
}
