#include "app.h"

#include "include/cef_command_line.h"
#include "include/wrapper/cef_helpers.h"
#include "scheme.h"
#include "trackers.h"
#include "util.h"
#include "window.h"

namespace sift {

CefMessageRouterConfig RouterConfig() {
  CefMessageRouterConfig config;
  config.js_query_function = "siftQuery";
  config.js_cancel_function = "siftQueryCancel";
  return config;
}

void SiftApp::OnBeforeCommandLineProcessing(const CefString& process_type, CefRefPtr<CefCommandLine> command_line) {
  if (!process_type.empty()) return;
  // Keep background work minimal: no first-run UI, no default-browser nag,
  // no component updates or field trials phoning home.
  command_line->AppendSwitch("no-first-run");
  command_line->AppendSwitch("no-default-browser-check");
  command_line->AppendSwitch("disable-component-update");
  command_line->AppendSwitch("disable-field-trial-config");
  command_line->AppendSwitch("disable-background-networking");
}

void SiftApp::OnRegisterCustomSchemes(CefRawPtr<CefSchemeRegistrar> registrar) {
  registrar->AddCustomScheme(kScheme, CEF_SCHEME_OPTION_STANDARD | CEF_SCHEME_OPTION_SECURE |
                                          CEF_SCHEME_OPTION_CORS_ENABLED | CEF_SCHEME_OPTION_FETCH_ENABLED);
}

void SiftApp::OnContextInitialized() {
  CEF_REQUIRE_UI_THREAD();
  RegisterSchemeHandlers();
  TrackerList::Get().Load(ResourceDir() + "/app/data/trackers.txt");

  CefRefPtr<CefCommandLine> cmd = CefCommandLine::GetGlobalCommandLine();
  WindowOptions options;
  options.profile = cmd->HasSwitch("profile") ? cmd->GetSwitchValue("profile").ToString() : "Default";
  if (!IsSafeKey(options.profile)) options.profile = "Default";
  options.incognito = cmd->HasSwitch("incognito");
  CefCommandLine::ArgumentList args;
  cmd->GetArguments(args);
  for (const auto& arg : args) options.open_urls.push_back(arg.ToString());
  SiftWindow::Open(options);
}

void SiftApp::OnWebKitInitialized() {
  renderer_router_ = CefMessageRouterRendererSide::Create(RouterConfig());
}

static bool IsAppFrame(CefRefPtr<CefFrame> frame) {
  const std::string url = frame->GetURL().ToString();
  return frame->IsMain() && url.rfind(kAppOrigin, 0) == 0;
}

void SiftApp::OnContextCreated(CefRefPtr<CefBrowser> browser, CefRefPtr<CefFrame> frame,
                               CefRefPtr<CefV8Context> context) {
  // Only Sift's own UI gets the bridge. Web pages never see siftQuery, and the
  // browser side additionally checks which browser a query came from.
  if (renderer_router_ && IsAppFrame(frame)) renderer_router_->OnContextCreated(browser, frame, context);
}

void SiftApp::OnContextReleased(CefRefPtr<CefBrowser> browser, CefRefPtr<CefFrame> frame,
                                CefRefPtr<CefV8Context> context) {
  if (renderer_router_) renderer_router_->OnContextReleased(browser, frame, context);
}

bool SiftApp::OnProcessMessageReceived(CefRefPtr<CefBrowser> browser, CefRefPtr<CefFrame> frame,
                                       CefProcessId source_process, CefRefPtr<CefProcessMessage> message) {
  return renderer_router_ && renderer_router_->OnProcessMessageReceived(browser, frame, source_process, message);
}

}  // namespace sift
