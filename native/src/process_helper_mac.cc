#include "include/cef_app.h"
#include "include/wrapper/cef_library_loader.h"
#include "app.h"

// Entry point for the macOS helper processes (renderer, GPU, utility).
int main(int argc, char* argv[]) {
  CefScopedLibraryLoader library_loader;
  if (!library_loader.LoadInHelper()) return 1;
  CefMainArgs main_args(argc, argv);
  CefRefPtr<sift::SiftApp> app = new sift::SiftApp();
  return CefExecuteProcess(main_args, app, nullptr);
}
