// CefApp for all processes: scheme registration, command-line defaults,
// startup and the renderer half of the UI message router.
#ifndef SIFT_APP_H_
#define SIFT_APP_H_

#include "include/cef_app.h"
#include "include/wrapper/cef_message_router.h"

namespace sift {

class SiftApp : public CefApp, public CefBrowserProcessHandler, public CefRenderProcessHandler {
 public:
  SiftApp() = default;

  // CefApp
  void OnBeforeCommandLineProcessing(const CefString& process_type, CefRefPtr<CefCommandLine> command_line) override;
  void OnRegisterCustomSchemes(CefRawPtr<CefSchemeRegistrar> registrar) override;
  CefRefPtr<CefBrowserProcessHandler> GetBrowserProcessHandler() override { return this; }
  CefRefPtr<CefRenderProcessHandler> GetRenderProcessHandler() override { return this; }

  // CefBrowserProcessHandler
  void OnContextInitialized() override;
  CefRefPtr<CefClient> GetDefaultClient() override { return nullptr; }

  // CefRenderProcessHandler
  void OnWebKitInitialized() override;
  void OnContextCreated(CefRefPtr<CefBrowser> browser, CefRefPtr<CefFrame> frame, CefRefPtr<CefV8Context> context) override;
  void OnContextReleased(CefRefPtr<CefBrowser> browser, CefRefPtr<CefFrame> frame, CefRefPtr<CefV8Context> context) override;
  bool OnProcessMessageReceived(CefRefPtr<CefBrowser> browser, CefRefPtr<CefFrame> frame, CefProcessId source_process,
                                CefRefPtr<CefProcessMessage> message) override;

 private:
  CefRefPtr<CefMessageRouterRendererSide> renderer_router_;
  IMPLEMENT_REFCOUNTING(SiftApp);
};

CefMessageRouterConfig RouterConfig();

}  // namespace sift

#endif  // SIFT_APP_H_
