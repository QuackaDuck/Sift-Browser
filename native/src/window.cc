#include "window.h"

#include <cmath>

#include "include/base/cef_callback.h"
#include "include/cef_parser.h"
#include "include/cef_urlrequest.h"
#include "include/cef_version.h"
#include "include/views/cef_button_delegate.h"
#include "include/views/cef_display.h"
#include "include/wrapper/cef_closure_task.h"
#include "include/wrapper/cef_helpers.h"
#include "app.h"
#include "clients.h"
#include "scheme.h"
#include "trackers.h"
#include "util.h"

namespace sift {

namespace {

constexpr cef_color_t kWindowColor = 0xFF0C0D0F;
constexpr cef_color_t kDividerColor = 0xFF0C0D0F;
constexpr int kDividerWidth = 6;

int g_window_count = 0;
int g_window_seq = 0;

#if defined(_WIN32)
constexpr char kPlatform[] = "win";
#elif defined(__APPLE__)
constexpr char kPlatform[] = "mac";
#else
constexpr char kPlatform[] = "linux";
#endif


class DividerDelegate : public CefPanelDelegate {
 public:
  CefSize GetPreferredSize(CefRefPtr<CefView> view) override { return CefSize(kDividerWidth, 0); }
  IMPLEMENT_REFCOUNTING(DividerDelegate);
};

class TabViewDelegate : public CefBrowserViewDelegate {
 public:
  explicit TabViewDelegate(SiftWindow* window) : window_(window) {}
  cef_runtime_style_t GetBrowserRuntimeStyle() override { return CEF_RUNTIME_STYLE_ALLOY; }
  CefSize GetPreferredSize(CefRefPtr<CefView> view) override { return CefSize(1, 1); }
  CefSize GetMinimumSize(CefRefPtr<CefView> view) override { return CefSize(120, 0); }
  CefRefPtr<CefBrowserViewDelegate> GetDelegateForPopupBrowserView(CefRefPtr<CefBrowserView> browser_view,
                                                                   const CefBrowserSettings& settings,
                                                                   CefRefPtr<CefClient> client,
                                                                   bool is_devtools) override {
    return new TabViewDelegate(window_);
  }
  bool OnPopupBrowserViewCreated(CefRefPtr<CefBrowserView> browser_view, CefRefPtr<CefBrowserView> popup_browser_view,
                                 bool is_devtools) override {
    if (is_devtools) return false;
    return window_->AdoptPopup(browser_view, popup_browser_view);
  }

 private:
  SiftWindow* window_;
  IMPLEMENT_REFCOUNTING(TabViewDelegate);
};

// The link-hover status label is a non-interactive button; CEF requires a delegate.
class StatusDelegate : public CefButtonDelegate {
 public:
  void OnButtonPressed(CefRefPtr<CefButton> button) override {}
  IMPLEMENT_REFCOUNTING(StatusDelegate);
};

// The UI browser fills the window and never changes size: resizing a
// renderer costs a relayout and a stale frame, and stalls its animations.
class UiViewDelegate : public CefBrowserViewDelegate {
 public:
  cef_runtime_style_t GetBrowserRuntimeStyle() override { return CEF_RUNTIME_STYLE_ALLOY; }
  IMPLEMENT_REFCOUNTING(UiViewDelegate);
};

class TextRequestClient : public CefURLRequestClient {
 public:
  explicit TextRequestClient(SiftWindow::QueryCallback cb) : cb_(cb) {}
  void OnRequestComplete(CefRefPtr<CefURLRequest> request) override {
    CefRefPtr<CefResponse> response = request->GetResponse();
    if (request->GetRequestStatus() != UR_SUCCESS || !response || response->GetStatus() != 200) {
      cb_->Failure(1, "request failed");
      return;
    }
    cb_->Success(body_);
  }
  void OnUploadProgress(CefRefPtr<CefURLRequest> request, int64_t current, int64_t total) override {}
  void OnDownloadProgress(CefRefPtr<CefURLRequest> request, int64_t current, int64_t total) override {}
  void OnDownloadData(CefRefPtr<CefURLRequest> request, const void* data, size_t data_length) override {
    if (body_.size() < 256 * 1024) body_.append(static_cast<const char*>(data), data_length);
  }
  bool GetAuthCredentials(bool isProxy, const CefString& host, int port, const CefString& realm,
                          const CefString& scheme, CefRefPtr<CefAuthCallback> callback) override {
    return false;
  }

 private:
  SiftWindow::QueryCallback cb_;
  std::string body_;
  IMPLEMENT_REFCOUNTING(TextRequestClient);
};

class DialogCallback : public CefRunFileDialogCallback {
 public:
  explicit DialogCallback(std::function<void(const std::vector<CefString>&)> fn) : fn_(std::move(fn)) {}
  void OnFileDialogDismissed(const std::vector<CefString>& file_paths) override { fn_(file_paths); }

 private:
  std::function<void(const std::vector<CefString>&)> fn_;
  IMPLEMENT_REFCOUNTING(DialogCallback);
};

std::string StringArg(CefRefPtr<CefDictionaryValue> args, const char* key) {
  return args && args->HasKey(key) && args->GetType(key) == VTYPE_STRING ? args->GetString(key).ToString() : "";
}

double NumberArg(CefRefPtr<CefDictionaryValue> args, const char* key, double fallback) {
  if (!args || !args->HasKey(key)) return fallback;
  if (args->GetType(key) == VTYPE_INT) return args->GetInt(key);
  if (args->GetType(key) == VTYPE_DOUBLE) return args->GetDouble(key);
  return fallback;
}

bool BoolArg(CefRefPtr<CefDictionaryValue> args, const char* key) {
  return args && args->HasKey(key) && args->GetType(key) == VTYPE_BOOL && args->GetBool(key);
}

bool IsWebUrl(const std::string& url) {
  return url.rfind("http://", 0) == 0 || url.rfind("https://", 0) == 0;
}

}  // namespace

// Routes DevTools protocol results back to the window that asked.
class DevToolsObserver : public CefDevToolsMessageObserver {
 public:
  explicit DevToolsObserver(SiftWindow* window) : window_(window) {}
  void OnDevToolsMethodResult(CefRefPtr<CefBrowser> browser, int message_id, bool success, const void* result,
                              size_t result_size) override {
    auto it = window_->devtools_pending_.find(message_id);
    if (it == window_->devtools_pending_.end()) return;
    auto done = std::move(it->second);
    window_->devtools_pending_.erase(it);
    CefRefPtr<CefValue> value =
        CefParseJSON(std::string(static_cast<const char*>(result), result_size), JSON_PARSER_RFC);
    CefRefPtr<CefDictionaryValue> dict =
        value && value->GetType() == VTYPE_DICTIONARY ? value->GetDictionary() : nullptr;
    // Continue outside the observer callback: continuations may issue more
    // DevTools calls, which must not re-enter the observer list.
    CefPostTask(TID_UI, base::BindOnce(
                            [](std::function<void(bool, CefRefPtr<CefDictionaryValue>)> fn, bool ok,
                               CefRefPtr<CefDictionaryValue> d) { fn(ok, d); },
                            std::move(done), success, dict));
  }

 private:
  SiftWindow* window_;
  IMPLEMENT_REFCOUNTING(DevToolsObserver);
};

// --- Construction -----------------------------------------------------------

void SiftWindow::Open(const WindowOptions& options) {
  CefWindow::CreateTopLevelWindow(new SiftWindow(options));
}

SiftWindow::SiftWindow(const WindowOptions& options) : options_(options) {
  window_id_ = "w" + std::to_string(++g_window_seq);
  if (options_.incognito) {
    CefRequestContextSettings settings;  // empty cache_path: kept in memory only
    context_ = CefRequestContext::CreateContext(settings, nullptr);
  } else if (options_.profile == "Default") {
    context_ = CefRequestContext::GetGlobalContext();
  } else {
    CefRequestContextSettings settings;
    const std::string dir = ProfileDir(options_.profile);
    MakeDirs(dir);
    CefString(&settings.cache_path) = dir;
    settings.persist_session_cookies = true;
    context_ = CefRequestContext::CreateContext(settings, nullptr);
  }
  if (context_ != CefRequestContext::GetGlobalContext()) {
    context_->RegisterSchemeHandlerFactory(kScheme, kAppHost, AppSchemeFactory());
  }
  router_ = CefMessageRouterBrowserSide::Create(RouterConfig());
  router_->AddHandler(this, false);
}

std::string SiftWindow::AppUrl() const {
  std::string url = std::string(kAppOrigin) + "index.html?window=" + window_id_ + "&profile=" + options_.profile;
  if (options_.incognito) url += "&private=1";
  return url;
}

CefRect SiftWindow::GetInitialBounds(CefRefPtr<CefWindow> window) {
  CefRefPtr<CefDisplay> display = CefDisplay::GetPrimaryDisplay();
  CefRect area = display ? display->GetWorkArea() : CefRect(0, 0, 1440, 900);
  const int w = std::min(1440, area.width - 80);
  const int h = std::min(920, area.height - 60);
  const int offset = (g_window_count % 6) * 28;
  return CefRect(area.x + (area.width - w) / 2 + offset, area.y + (area.height - h) / 2 + offset, w, h);
}

#if !defined(__APPLE__)
void ConfigureNativeWindow(CefRefPtr<CefWindow> window) {}
bool UsesLiquidGlassTitlebar() { return false; }
int TrafficLightsRight(CefRefPtr<CefWindow> window) { return 0; }
void MakeKeyWindowFor(CefWindowHandle handle) {}
void AlignTrafficLights(CefRefPtr<CefWindow> window, float center, float* titlebar_height) {}
#endif

void SiftWindow::OnWindowCreated(CefRefPtr<CefWindow> window) {
  CEF_REQUIRE_UI_THREAD();
  ++g_window_count;
  window_ = window;
  window_->SetBackgroundColor(kWindowColor);
  window_->SetTitle(options_.incognito ? "Sift (Private)" : "Sift");

  CefBoxLayoutSettings vertical;
  vertical.horizontal = false;
  window_layout_ = window_->SetToBoxLayout(vertical);

  content_ = CefPanel::CreatePanel(nullptr);
  content_->SetBackgroundColor(kWindowColor);
  CefBoxLayoutSettings horizontal;
  horizontal.horizontal = true;
  content_layout_ = content_->SetToBoxLayout(horizontal);
  divider_ = CefPanel::CreatePanel(new DividerDelegate());
  divider_->SetBackgroundColor(kDividerColor);
  divider_->SetVisible(false);
  content_->AddChildView(divider_);

  ui_client_ = new UiClient(this);
  CefBrowserSettings ui_settings;
  ui_settings.background_color = kWindowColor;
  ui_view_ = CefBrowserView::CreateBrowserView(ui_client_, AppUrl(), ui_settings, nullptr, context_,
                                               new UiViewDelegate());
  window_->AddChildView(ui_view_);
  window_layout_->SetFlexForView(ui_view_, 1);

  // Web content floats over the UI below the chrome strip. It stays hidden
  // until the UI reports its layout, so pages never load at a wrong size.
  // The overlay leaves the tab row alone, so on macOS (where overlays are
  // child windows) it never covers the traffic lights.
  content_overlay_ = window_->AddOverlayView(content_, CEF_DOCKING_MODE_CUSTOM, true);

  // Link-hover status text: a native overlay so it can sit over web content
  // without growing the UI surface.
  status_ = CefLabelButton::CreateLabelButton(new StatusDelegate(), "");
  status_->SetBackgroundColor(0xF0181A1E);
  status_->SetTextColor(CEF_BUTTON_STATE_NORMAL, 0xFFB9BCC3);
  status_->SetFontList("Inter, Segoe UI, Helvetica, 12px");
  status_->SetEnabledTextColors(0xFFB9BCC3);
  status_overlay_ = window_->AddOverlayView(status_, CEF_DOCKING_MODE_BOTTOM_LEFT, false);
  status_overlay_->SetInsets(CefInsets(0, 8, 8, 0));

  CefRefPtr<CefImage> icon = CefImage::CreateImage();
  std::string png;
  if (ReadFile(ResourceDir() + "/app/assets/icon-256.png", &png)) {
    icon->AddPNG(1.0f, png.data(), png.size());
    window_->SetWindowAppIcon(icon);
    window_->SetWindowIcon(icon);
  }

  ApplySurface();
  window_->Show();
  ConfigureNativeWindow(window_);
  AlignTrafficLights(window_, tabrow_height_ / 2.0f, &titlebar_height_);
  ui_view_->RequestFocus();
}

void SiftWindow::OnWindowDestroyed(CefRefPtr<CefWindow> window) {
  router_->RemoveHandler(this);
  for (auto& [id, tab] : tabs_) tab.devtools_registration = nullptr;
  tabs_.clear();
  ui_view_ = nullptr;
  ui_browser_ = nullptr;
  content_overlay_ = nullptr;
  status_overlay_ = nullptr;
  window_ = nullptr;
  if (--g_window_count == 0) CefQuitMessageLoop();
}

bool SiftWindow::CanClose(CefRefPtr<CefWindow> window) {
  closing_ = true;
  bool can_close = true;
  for (auto& [id, tab] : tabs_) {
    if (tab.browser && !tab.browser->GetHost()->TryCloseBrowser()) can_close = false;
  }
  if (ui_browser_ && !ui_browser_->GetHost()->TryCloseBrowser()) can_close = false;
  return can_close;
}

void SiftWindow::MaybeFinishClose() {
  if (!closing_ || !window_) return;
  for (auto& [id, tab] : tabs_) {
    if (tab.browser) return;
  }
  if (ui_browser_) return;
  window_->Close();
}

// --- Geometry ---------------------------------------------------------------

void SiftWindow::OnWindowBoundsChanged(CefRefPtr<CefWindow> window, const CefRect& new_bounds) {
  if (!ui_ready_) return;
  auto d = NewDict();
  d->SetBool("maximized", window_->IsMaximized());
  d->SetBool("fullscreen", window_->IsFullscreen());
  d->SetInt("width", new_bounds.width);
  d->SetInt("height", new_bounds.height);
  Emit("window.state", d);
}

void SiftWindow::OnLayoutChanged(CefRefPtr<CefView> view, const CefRect& new_bounds) {
  if (window_ && view->IsSame(window_)) ApplySurface();
}

void SiftWindow::OnWindowActivationChanged(CefRefPtr<CefWindow> window, bool active) {
  if (!ui_ready_) return;
  auto d = NewDict();
  d->SetBool("active", active);
  Emit("window.state", d);
}

bool SiftWindow::OnKeyEvent(CefRefPtr<CefWindow> window, const CefKeyEvent& event) { return false; }

// strip: web content over the UI, below the chrome strip.
// cover: content hidden; the UI shows a snapshot of it with its menus,
//        results or previews on top (the snapshot is identical, so hiding
//        the content isn't visible).
// full:  content hidden for Sift's own pages.
// Only the overlay is shown, hidden or moved; the UI never resizes.
void SiftWindow::ApplySurface() {
  if (!window_ || !content_overlay_) return;
  const bool fullscreen_tab = !fullscreen_tab_.empty();
  const bool show = fullscreen_tab || (surface_ == "strip" && layout_known_ && !panes_.empty());
  if (show) {
    const CefRect b = window_->GetBounds();
    const int top = fullscreen_tab ? 0 : chrome_height_;
    const CefRect want(0, top, b.width, std::max(0, b.height - top));
    if (!(content_overlay_->GetBounds() == want)) content_overlay_->SetBounds(want);
  }
  if (content_overlay_->IsVisible() != show) content_overlay_->SetVisible(show);
  if (status_overlay_ && !show) status_overlay_->SetVisible(false);
}

void SiftWindow::SetSurface(const std::string& mode) {
  if (mode != "strip" && mode != "cover" && mode != "full") return;
  surface_ = mode;
  ApplySurface();
}

void SiftWindow::EnsureBrowser(Tab* tab) {
  if (tab->view || tab->closing) return;
  CefBrowserSettings settings;
  settings.background_color = 0xFFFFFFFF;
  const std::string url = tab->pending_url.empty() ? "about:blank" : tab->pending_url;
  tab->view = CefBrowserView::CreateBrowserView(NewContentClient(tab->id), url, settings, nullptr, context_,
                                                new TabViewDelegate(this));
  tab->view->SetVisible(false);
  content_->AddChildView(tab->view);
}

void SiftWindow::ApplyLayout() {
  if (!window_) return;
  std::vector<std::string> visible = fullscreen_tab_.empty() ? panes_ : std::vector<std::string>{fullscreen_tab_};
  for (const auto& id : visible) {
    if (Tab* tab = FindTab(id)) EnsureBrowser(tab);
  }
  for (auto& [id, tab] : tabs_) {
    if (!tab.view) continue;
    const bool show = std::find(visible.begin(), visible.end(), id) != visible.end();
    tab.view->SetVisible(show);
  }
  const bool split = visible.size() == 2;
  divider_->SetVisible(split);
  int index = 0;
  for (size_t i = 0; i < visible.size(); ++i) {
    Tab* tab = FindTab(visible[i]);
    if (!tab || !tab->view) continue;
    content_->ReorderChildView(tab->view, index++);
    if (split && i == 0) content_->ReorderChildView(divider_, index++);
    int flex = 1000;
    if (split) {
      const int left = static_cast<int>(std::lround(std::clamp(ratio_, 0.15, 0.85) * 1000));
      flex = i == 0 ? left : 1000 - left;
    }
    content_layout_->SetFlexForView(tab->view, flex);
  }
  content_layout_->SetFlexForView(divider_, 0);
  // Flex changes alone don't trigger a layout pass.
  content_->InvalidateLayout();
  ApplySurface();
  content_->Layout();
}

// --- Tabs -------------------------------------------------------------------

SiftWindow::Tab* SiftWindow::FindTab(const std::string& id) {
  auto it = tabs_.find(id);
  return it == tabs_.end() ? nullptr : &it->second;
}

SiftWindow::Tab* SiftWindow::TabForBrowser(int browser_id) {
  for (auto& [id, tab] : tabs_) {
    if (tab.browser && tab.browser->GetIdentifier() == browser_id) return &tab;
  }
  return nullptr;
}

CefRefPtr<ContentClient> SiftWindow::NewContentClient(const std::string& tab_id) {
  return new ContentClient(this, tab_id);
}

void SiftWindow::OnTabBrowserCreated(const std::string& tab_id, CefRefPtr<CefBrowser> browser) {
  if (popup_window_ids_.count(tab_id)) return;
  Tab& tab = tabs_[tab_id];
  tab.id = tab_id;
  tab.browser = browser;
  tab.devtools_registration = browser->GetHost()->AddDevToolsMessageObserver(new DevToolsObserver(this));
  if (tab.zoom != 0) browser->GetHost()->SetZoomLevel(tab.zoom);
}

void SiftWindow::OnTabBrowserClosed(const std::string& tab_id) {
  Tab* tab = FindTab(tab_id);
  if (!tab) return;
  if (tab->view && content_) content_->RemoveChildView(tab->view);
  tab->devtools_registration = nullptr;
  tab->view = nullptr;
  tab->browser = nullptr;
  if (tab->discarding) {
    tab->discarding = false;
    tab->closing = false;
  } else {
    const bool closed_by_page = !tab->closing && !closing_;
    tabs_.erase(tab_id);
    if (closed_by_page) {
      // window.close() from the page: let the UI drop the tab.
      auto d = NewDict();
      d->SetString("id", tab_id);
      Emit("tab.closed", d);
    }
  }
  MaybeFinishClose();
}

void SiftWindow::OnTabLoadEnd(const std::string& tab_id) {
  Tab* tab = FindTab(tab_id);
  if (!tab || !tab->browser) return;
  if (tab->restore_scroll > 0) {
    tab->browser->GetMainFrame()->ExecuteJavaScript(
        "window.scrollTo(0," + std::to_string(tab->restore_scroll) + ")", "", 0);
    tab->restore_scroll = -1;
  }
  auto d = NewDict();
  d->SetBool("loaded", true);
  EmitTab(tab_id, d);
}

void SiftWindow::CloseTab(const std::string& id) {
  Tab* tab = FindTab(id);
  if (!tab) return;
  panes_.erase(std::remove(panes_.begin(), panes_.end(), id), panes_.end());
  if (fullscreen_tab_ == id) fullscreen_tab_.clear();
  if (!tab->browser) {
    if (tab->view) content_->RemoveChildView(tab->view);
    tabs_.erase(id);
    return;
  }
  tab->closing = true;
  if (tab->view) tab->view->SetVisible(false);
  tab->browser->GetHost()->CloseBrowser(true);
}

std::string SiftWindow::ReservePopup(int opener_browser_id, int disposition, const std::string& url) {
  const std::string id = "p" + window_id_ + "-" + std::to_string(next_popup_id_++);
  pending_popups_[opener_browser_id].push_back({id, disposition});
  if (disposition == CEF_WOD_NEW_POPUP || disposition == CEF_WOD_NEW_WINDOW) popup_window_ids_.insert(id);
  return id;
}

bool SiftWindow::AdoptPopup(CefRefPtr<CefBrowserView> opener, CefRefPtr<CefBrowserView> popup) {
  CefRefPtr<CefBrowser> opener_browser = opener->GetBrowser();
  if (!opener_browser) return false;
  auto it = pending_popups_.find(opener_browser->GetIdentifier());
  if (it == pending_popups_.end() || it->second.empty()) return false;
  PendingPopup pending = it->second.front();
  it->second.erase(it->second.begin());
  if (popup_window_ids_.count(pending.tab_id)) return false;  // real popup window, CEF hosts it

  Tab& tab = tabs_[pending.tab_id];
  tab.id = pending.tab_id;
  tab.view = popup;
  popup->SetVisible(false);
  content_->AddChildView(popup);

  Tab* opener_tab = TabForBrowser(opener_browser->GetIdentifier());
  auto d = NewDict();
  d->SetString("id", pending.tab_id);
  d->SetString("openerId", opener_tab ? opener_tab->id : "");
  d->SetBool("background", pending.disposition == CEF_WOD_NEW_BACKGROUND_TAB);
  Emit("tab.opened", d);
  return true;
}

// --- Snapshots & DevTools protocol -----------------------------------------

int SiftWindow::DevTools(Tab* tab, const std::string& method, CefRefPtr<CefDictionaryValue> params,
                         std::function<void(bool, CefRefPtr<CefDictionaryValue>)> done) {
  if (!tab || !tab->browser) {
    done(false, nullptr);
    return 0;
  }
  const int id = next_devtools_id_++;
  devtools_pending_[id] = std::move(done);
  if (tab->browser->GetHost()->ExecuteDevToolsMethod(id, method, params) == 0) {
    auto fn = std::move(devtools_pending_[id]);
    devtools_pending_.erase(id);
    fn(false, nullptr);
    return 0;
  }
  return id;
}

void SiftWindow::Capture(Tab* tab, double scale, int quality, std::function<void(const std::string&)> done) {
  auto params = NewDict();
  params->SetString("format", "jpeg");
  params->SetInt("quality", quality);
  params->SetBool("optimizeForSpeed", true);
  if (scale >= 1.0) {
    DevTools(tab, "Page.captureScreenshot", params, [done](bool ok, CefRefPtr<CefDictionaryValue> result) {
      done(ok && result ? "data:image/jpeg;base64," + result->GetString("data").ToString() : "");
    });
    return;
  }
  const std::string id = tab->id;
  DevTools(tab, "Page.getLayoutMetrics", nullptr,
           [this, id, params, scale, done](bool ok, CefRefPtr<CefDictionaryValue> metrics) {
             Tab* tab = FindTab(id);
             if (!ok || !metrics || !tab) return done("");
             CefRefPtr<CefDictionaryValue> vp = metrics->GetDictionary("cssVisualViewport");
             if (!vp) return done("");
             // Whole numbers arrive as ints; GetDouble() would read them as 0.
             auto num = [&vp](const char* key) { return NumberArg(vp, key, 0); };
             auto clip = NewDict();
             clip->SetDouble("x", num("pageX"));
             clip->SetDouble("y", num("pageY"));
             clip->SetDouble("width", num("clientWidth"));
             clip->SetDouble("height", num("clientHeight"));
             clip->SetDouble("scale", scale);
             params->SetDictionary("clip", clip);
             DevTools(tab, "Page.captureScreenshot", params, [done](bool ok, CefRefPtr<CefDictionaryValue> result) {
               done(ok && result ? "data:image/jpeg;base64," + result->GetString("data").ToString() : "");
             });
           });
}

void SiftWindow::CaptureVisible(std::function<void(CefRefPtr<CefListValue>)> done) {
  struct State {
    CefRefPtr<CefListValue> shots = CefListValue::Create();
    int remaining = 0;
    bool finished = false;
    std::function<void(CefRefPtr<CefListValue>)> done;
  };
  auto state = std::make_shared<State>();
  state->done = std::move(done);
  auto finish = [state]() {
    if (state->finished) return;
    state->finished = true;
    state->done(state->shots);
  };
  std::vector<Tab*> targets;
  for (const auto& id : panes_) {
    Tab* tab = FindTab(id);
    if (tab && tab->browser && !tab->closing) targets.push_back(tab);
  }
  state->remaining = static_cast<int>(targets.size());
  if (targets.empty()) return finish();
  for (Tab* tab : targets) {
    const std::string id = tab->id;
    Capture(tab, 1.0, 82, [state, id, finish](const std::string& data) {
      if (state->finished) return;
      if (!data.empty()) {
        auto shot = NewDict();
        shot->SetString("id", id);
        shot->SetString("data", data);
        state->shots->SetDictionary(state->shots->GetSize(), shot);
      }
      if (--state->remaining == 0) finish();
    });
  }
  // Never let a stuck renderer hold the UI hostage.
  CefPostDelayedTask(TID_UI, base::BindOnce([](std::function<void()> fn) { fn(); }, std::function<void()>(finish)),
                     600);
}

void SiftWindow::Evaluate(Tab* tab, const std::string& expression, std::function<void(CefRefPtr<CefValue>)> done) {
  auto params = NewDict();
  params->SetString("expression", expression);
  params->SetBool("returnByValue", true);
  DevTools(tab, "Runtime.evaluate", params, [done](bool ok, CefRefPtr<CefDictionaryValue> result) {
    CefRefPtr<CefValue> value = CefValue::Create();
    if (ok && result && result->HasKey("result")) {
      CefRefPtr<CefDictionaryValue> inner = result->GetDictionary("result");
      if (inner && inner->HasKey("value")) value = inner->GetValue("value");
    }
    done(value);
  });
}

// --- Events to the UI -------------------------------------------------------

void SiftWindow::Emit(const std::string& type, CefRefPtr<CefDictionaryValue> data) {
  if (!ui_browser_ || !ui_ready_) return;
  auto envelope = NewDict();
  envelope->SetString("type", type);
  envelope->SetDictionary("data", data ? data : NewDict());
  CefRefPtr<CefValue> value = CefValue::Create();
  value->SetDictionary(envelope);
  ui_browser_->GetMainFrame()->ExecuteJavaScript("window.__siftHost&&window.__siftHost(" + ToJson(value) + ")",
                                                 kAppOrigin, 0);
}

void SiftWindow::EmitTab(const std::string& tab_id, CefRefPtr<CefDictionaryValue> data) {
  if (popup_window_ids_.count(tab_id)) return;
  data->SetString("id", tab_id);
  Emit("tab.state", data);
}

void SiftWindow::OnShortcut(const std::string& name) {
  auto d = NewDict();
  d->SetString("name", name);
  Emit("shortcut", d);
}

void SiftWindow::OnFullscreenRequest(const std::string& tab_id, bool fullscreen) {
  fullscreen_tab_ = fullscreen ? tab_id : "";
  window_->SetFullscreen(fullscreen);
  ApplyLayout();
  if (!fullscreen) ApplySurface();
  auto d = NewDict();
  d->SetBool("fullscreen", fullscreen);
  d->SetString("id", tab_id);
  Emit("fullscreen", d);
}

void SiftWindow::OnStatusText(const std::string& tab_id, const std::string& text) {
  if (!status_ || !status_overlay_) return;
  const bool show = !text.empty() && surface_ == "strip" && fullscreen_tab_.empty();
  if (show) {
    std::string shown = text.size() > 120 ? text.substr(0, 117) + "..." : text;
    status_->SetText("  " + shown + "  ");
    status_overlay_->SizeToPreferredSize();
  }
  status_overlay_->SetVisible(show);
}

void SiftWindow::OnDraggableRegions(const std::vector<CefDraggableRegion>& regions) {
  if (window_) window_->SetDraggableRegions(regions);
}

void SiftWindow::RegisterPermissionCallback(uint64_t id, std::function<void(const std::string&)> cb) {
  permission_callbacks_[id] = std::move(cb);
}

void SiftWindow::RegisterDownload(uint32_t id, CefRefPtr<CefDownloadItemCallback> cb) { downloads_[id] = cb; }

bool SiftWindow::IsUiBrowser(CefRefPtr<CefBrowser> browser) const {
  return ui_browser_ && browser && ui_browser_->IsSame(browser);
}

void SiftWindow::OnUiBrowserCreated(CefRefPtr<CefBrowser> browser) { ui_browser_ = browser; }

void SiftWindow::OnUiBrowserClosed() {
  ui_browser_ = nullptr;
  ui_ready_ = false;
  MaybeFinishClose();
}

void SiftWindow::FocusUi() {
  if (!ui_view_ || !ui_browser_) return;
  ui_view_->RequestFocus();
  MakeKeyWindowFor(ui_browser_->GetHost()->GetWindowHandle());
  ui_browser_->GetHost()->SetFocus(true);
}

// --- Bridge -----------------------------------------------------------------

bool SiftWindow::OnQuery(CefRefPtr<CefBrowser> browser, CefRefPtr<CefFrame> frame, int64_t query_id,
                         const CefString& request, bool persistent, QueryCallback callback) {
  // Only Sift's own UI may drive the browser.
  if (!IsUiBrowser(browser) || !frame->IsMain() || frame->GetURL().ToString().rfind(kAppOrigin, 0) != 0) {
    return false;
  }
  CefRefPtr<CefValue> parsed = CefParseJSON(request, JSON_PARSER_RFC);
  if (!parsed || parsed->GetType() != VTYPE_DICTIONARY) {
    callback->Failure(400, "bad request");
    return true;
  }
  CefRefPtr<CefDictionaryValue> msg = parsed->GetDictionary();
  const std::string cmd = msg->GetString("cmd").ToString();
  CefRefPtr<CefDictionaryValue> args = msg->HasKey("args") ? msg->GetDictionary("args") : NewDict();
  if (!args) args = NewDict();
  if (!Dispatch(cmd, args, callback)) callback->Failure(404, "unknown command: " + cmd);
  return true;
}

void SiftWindow::ReplyJson(QueryCallback cb, CefRefPtr<CefValue> value) {
  cb->Success(value ? ToJson(value) : "null");
}

static CefRefPtr<CefValue> Val(CefRefPtr<CefDictionaryValue> d) {
  CefRefPtr<CefValue> v = CefValue::Create();
  v->SetDictionary(d);
  return v;
}

static CefRefPtr<CefValue> Val(const std::string& s) {
  CefRefPtr<CefValue> v = CefValue::Create();
  v->SetString(s);
  return v;
}

static const double kZoomFactors[] = {0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1.0, 1.1,
                                      1.25, 1.5,  1.75, 2.0, 2.5,  3.0, 4.0, 5.0};

bool SiftWindow::Dispatch(const std::string& cmd, Args args, QueryCallback cb) {
  const std::string id = StringArg(args, "id");
  Tab* tab = id.empty() ? nullptr : FindTab(id);
  CefRefPtr<CefBrowserHost> host = tab && tab->browser ? tab->browser->GetHost() : nullptr;

  if (cmd == "ready") {
    ui_ready_ = true;
    auto d = NewDict();
    d->SetString("windowId", window_id_);
    d->SetString("profile", options_.profile);
    d->SetBool("incognito", options_.incognito);
    d->SetString("platform", kPlatform);
    d->SetString("engine", std::string("CEF ") + CEF_VERSION);
    d->SetString("chromium", std::to_string(CHROME_VERSION_MAJOR) + "." + std::to_string(CHROME_VERSION_MINOR) + "." +
                                 std::to_string(CHROME_VERSION_BUILD) + "." + std::to_string(CHROME_VERSION_PATCH));
    d->SetBool("liquidGlass", UsesLiquidGlassTitlebar());
    d->SetInt("trafficLightsRight", TrafficLightsRight(window_));
    d->SetInt("trackerDomains", static_cast<int>(TrackerList::Get().size()));
    d->SetInt("width", window_->GetBounds().width);
    d->SetInt("height", window_->GetBounds().height);
    d->SetString("downloadsDir", DownloadsDir());
    d->SetString("dataDir", options_.incognito ? "(in memory)" : ProfileDir(options_.profile));
    CefRefPtr<CefListValue> urls = CefListValue::Create();
    for (const auto& url : options_.open_urls) urls->SetString(urls->GetSize(), url);
    options_.open_urls.clear();
    d->SetList("openUrls", urls);
    // A reloaded UI (e.g. after its renderer crashed) restores the saved
    // session itself, so tabs from the previous UI instance are closed.
    std::vector<std::string> stale;
    for (const auto& [tab_id, t] : tabs_) stale.push_back(tab_id);
    for (const auto& tab_id : stale) CloseTab(tab_id);
    panes_.clear();
    ApplyLayout();
    ReplyJson(cb, Val(d));
    return true;
  }

  if (cmd == "tab.create") {
    if (id.empty()) return false;
    Tab& t = tabs_[id];
    t.id = id;
    t.pending_url = StringArg(args, "url");
    t.restore_scroll = static_cast<int>(NumberArg(args, "scroll", -1));
    if (!BoolArg(args, "lazy")) EnsureBrowser(&t);
    cb->Success("true");
    return true;
  }
  if (cmd == "tab.navigate") {
    if (!tab) return false;
    const std::string url = StringArg(args, "url");
    if (tab->browser) tab->browser->GetMainFrame()->LoadURL(url);
    else tab->pending_url = url;
    cb->Success("true");
    return true;
  }
  if (cmd == "tab.back" || cmd == "tab.forward" || cmd == "tab.reload" || cmd == "tab.stop") {
    if (tab && tab->browser) {
      if (cmd == "tab.back") tab->browser->GoBack();
      else if (cmd == "tab.forward") tab->browser->GoForward();
      else if (cmd == "tab.stop") tab->browser->StopLoad();
      else if (BoolArg(args, "hard")) tab->browser->ReloadIgnoreCache();
      else tab->browser->Reload();
    } else if (tab && cmd == "tab.reload") {
      EnsureBrowser(tab);
    }
    cb->Success("true");
    return true;
  }
  if (cmd == "tab.close") {
    CloseTab(id);
    ApplyLayout();
    cb->Success("true");
    return true;
  }
  if (cmd == "tab.discard") {
    if (tab && tab->browser && std::find(panes_.begin(), panes_.end(), id) == panes_.end()) {
      tab->pending_url = StringArg(args, "url");
      tab->discarding = true;
      tab->closing = true;
      tab->browser->GetHost()->CloseBrowser(true);
    }
    cb->Success("true");
    return true;
  }
  if (cmd == "layout") {
    layout_known_ = true;
    chrome_height_ = std::clamp(static_cast<int>(NumberArg(args, "top", chrome_height_)), 0, 400);
    const int tabrow = std::clamp(static_cast<int>(NumberArg(args, "tabrow", tabrow_height_)), 24, 80);
    if (tabrow != tabrow_height_) {
      tabrow_height_ = tabrow;
      AlignTrafficLights(window_, tabrow_height_ / 2.0f, &titlebar_height_);
    }
    ratio_ = NumberArg(args, "ratio", ratio_);
    panes_.clear();
    if (CefRefPtr<CefListValue> panes = args->GetList("panes")) {
      for (size_t i = 0; i < panes->GetSize() && i < 2; ++i) {
        const std::string pane = panes->GetString(i).ToString();
        if (FindTab(pane)) panes_.push_back(pane);
      }
    }
    ApplyLayout();
    cb->Success("true");
    return true;
  }
  if (cmd == "surface") {
    SetSurface(StringArg(args, "mode"));
    cb->Success("true");
    return true;
  }
  if (cmd == "snapshot") {
    CaptureVisible([this, cb](CefRefPtr<CefListValue> shots) {
      CefRefPtr<CefValue> v = CefValue::Create();
      v->SetList(shots);
      ReplyJson(cb, v);
    });
    return true;
  }
  if (cmd == "thumbnail") {
    if (!tab || !tab->browser) {
      cb->Success("null");
      return true;
    }
    Capture(tab, NumberArg(args, "scale", 0.3), 60, [this, cb](const std::string& data) {
      if (data.empty()) cb->Success("null");
      else ReplyJson(cb, Val(data));
    });
    return true;
  }
  if (cmd == "tab.zoom") {
    if (!tab) return false;
    double factor = std::pow(1.2, tab->zoom);
    const int delta = static_cast<int>(NumberArg(args, "delta", 0));
    if (delta == 0) {
      factor = 1.0;
    } else {
      size_t i = 0;
      while (i + 1 < std::size(kZoomFactors) && kZoomFactors[i] < factor - 0.001) ++i;
      if (delta > 0) i = std::min(i + 1, std::size(kZoomFactors) - 1);
      else if (i > 0) i -= 1;
      factor = kZoomFactors[i];
    }
    tab->zoom = std::log(factor) / std::log(1.2);
    if (host) host->SetZoomLevel(tab->zoom);
    ReplyJson(cb, Val(std::to_string(static_cast<int>(std::lround(factor * 100)))));
    return true;
  }
  if (cmd == "tab.find") {
    if (host) {
      const std::string text = StringArg(args, "text");
      if (text.empty()) host->StopFinding(true);
      else host->Find(text, !BoolArg(args, "backward"), false, BoolArg(args, "next"));
    }
    cb->Success("true");
    return true;
  }
  if (cmd == "tab.findStop") {
    if (host) host->StopFinding(!BoolArg(args, "keepSelection"));
    cb->Success("true");
    return true;
  }
  if (cmd == "tab.print") {
    if (host) host->Print();
    cb->Success("true");
    return true;
  }
  if (cmd == "tab.devtools") {
    if (host) {
      CefWindowInfo info;
      CefBrowserSettings settings;
      host->ShowDevTools(info, nullptr, settings, CefPoint());
    }
    cb->Success("true");
    return true;
  }
  if (cmd == "tab.mute") {
    if (host) host->SetAudioMuted(BoolArg(args, "muted"));
    cb->Success("true");
    return true;
  }
  if (cmd == "tab.scroll") {
    if (!tab || !tab->browser) {
      cb->Success("0");
      return true;
    }
    Evaluate(tab, "Math.round(window.scrollY)", [this, cb](CefRefPtr<CefValue> value) {
      ReplyJson(cb, value);
    });
    return true;
  }
  if (cmd == "tab.focus") {
    if (tab && tab->view && surface_ == "strip") {
      // Focus the view before activating its window: a window activated with
      // nothing focused moves focus as if by Tab, which focuses the page's
      // first link (e.g. a "skip to content" link).
      tab->view->RequestFocus();
      if (host) MakeKeyWindowFor(host->GetWindowHandle());
      if (host) host->SetFocus(true);
    }
    cb->Success("true");
    return true;
  }
  if (cmd == "ui.focus") {
    FocusUi();
    cb->Success("true");
    return true;
  }

  if (cmd == "window.minimize") {
    window_->Minimize();
    cb->Success("true");
    return true;
  }
  if (cmd == "window.maximize") {
    if (window_->IsMaximized()) window_->Restore();
    else window_->Maximize();
    cb->Success("true");
    return true;
  }
  if (cmd == "window.fullscreen") {
    window_->SetFullscreen(!window_->IsFullscreen());
    cb->Success("true");
    return true;
  }
  if (cmd == "window.close") {
    window_->Close();
    cb->Success("true");
    return true;
  }
  if (cmd == "window.new") {
    WindowOptions options;
    options.incognito = BoolArg(args, "incognito");
    const std::string profile = StringArg(args, "profile");
    options.profile = IsSafeKey(profile) ? profile : options_.profile;
    if (CefRefPtr<CefListValue> urls = args->GetList("urls")) {
      for (size_t i = 0; i < urls->GetSize(); ++i) options.open_urls.push_back(urls->GetString(i).ToString());
    }
    SiftWindow::Open(options);
    cb->Success("true");
    return true;
  }

  if (cmd == "store.read") {
    StoreRead(args, cb);
    return true;
  }
  if (cmd == "store.write") {
    StoreWrite(args, cb);
    return true;
  }

  if (cmd == "download.cancel" || cmd == "download.pause" || cmd == "download.resume") {
    auto it = downloads_.find(static_cast<uint32_t>(NumberArg(args, "downloadId", -1)));
    if (it != downloads_.end()) {
      if (cmd == "download.cancel") it->second->Cancel();
      else if (cmd == "download.pause") it->second->Pause();
      else it->second->Resume();
    }
    cb->Success("true");
    return true;
  }
  if (cmd == "download.open" || cmd == "download.reveal") {
    const std::string path = StringArg(args, "path");
    // Only open files that live in the downloads folder.
    if (!path.empty() && path.rfind(DownloadsDir(), 0) == 0 && path.find("..") == std::string::npos) {
      OpenWithSystem(path, cmd == "download.reveal");
    }
    cb->Success("true");
    return true;
  }

  if (cmd == "permission.respond") {
    const uint64_t prompt = std::strtoull(StringArg(args, "promptId").c_str(), nullptr, 10);
    auto it = permission_callbacks_.find(prompt);
    if (it != permission_callbacks_.end()) {
      it->second(StringArg(args, "result"));
      permission_callbacks_.erase(it);
    }
    cb->Success("true");
    return true;
  }

  if (cmd == "fetch") {
    FetchText(StringArg(args, "url"), cb);
    return true;
  }
  if (cmd == "import.sources") {
    ImportSources(cb);
    return true;
  }
  if (cmd == "file.open" || cmd == "file.save") {
    FileDialog(args, cb);
    return true;
  }
  if (cmd == "pref.set") {
    SetPref(args, cb);
    return true;
  }
  if (cmd == "trackers.enabled") {
    TrackerList::Get().set_enabled(BoolArg(args, "enabled"));
    cb->Success("true");
    return true;
  }
  if (cmd == "data.clear") {
    ClearData(args, cb);
    return true;
  }
  if (cmd == "app.quit") {
    CefQuitMessageLoop();
    cb->Success("true");
    return true;
  }
  return false;
}

// --- Storage ----------------------------------------------------------------

static std::string StorePath(const std::string& scope, const std::string& profile, const std::string& key) {
  if (scope == "app") return JoinPath(UserDataRoot(), "sift-" + key + ".json");
  return JoinPath(JoinPath(ProfileDir(profile), "Sift"), key + ".json");
}

void SiftWindow::StoreRead(Args args, QueryCallback cb) {
  const std::string key = StringArg(args, "key");
  if (!IsSafeKey(key)) return cb->Failure(400, "bad key");
  std::string data;
  if (!ReadFile(StorePath(StringArg(args, "scope"), options_.profile, key), &data)) return cb->Success("null");
  ReplyJson(cb, Val(data));
}

void SiftWindow::StoreWrite(Args args, QueryCallback cb) {
  const std::string key = StringArg(args, "key");
  if (!IsSafeKey(key)) return cb->Failure(400, "bad key");
  // Private windows never write browsing traces to disk.
  if (options_.incognito && (key == "history" || key.rfind("session", 0) == 0 || key == "closed")) {
    return cb->Success("false");
  }
  const std::string scope = StringArg(args, "scope");
  const std::string path = StorePath(scope, options_.profile, key);
  MakeDirs(path.substr(0, path.find_last_of("/\\")));
  cb->Success(WriteFileAtomic(path, StringArg(args, "value")) ? "true" : "false");
}

// --- Import, files, network -------------------------------------------------

void SiftWindow::ImportSources(QueryCallback cb) {
  struct Source {
    const char* id;
    const char* name;
    const char* path;
  };
#if defined(_WIN32)
  const char* base_env = std::getenv("LOCALAPPDATA");
  const std::string base = base_env ? base_env : "";
  static const Source kSources[] = {
      {"chrome", "Google Chrome", "Google\\Chrome\\User Data\\Default\\Bookmarks"},
      {"edge", "Microsoft Edge", "Microsoft\\Edge\\User Data\\Default\\Bookmarks"},
      {"brave", "Brave", "BraveSoftware\\Brave-Browser\\User Data\\Default\\Bookmarks"},
      {"vivaldi", "Vivaldi", "Vivaldi\\User Data\\Default\\Bookmarks"},
      {"chromium", "Chromium", "Chromium\\User Data\\Default\\Bookmarks"},
  };
#elif defined(__APPLE__)
  const std::string base = JoinPath(HomeDir(), "Library/Application Support");
  static const Source kSources[] = {
      {"chrome", "Google Chrome", "Google/Chrome/Default/Bookmarks"},
      {"edge", "Microsoft Edge", "Microsoft Edge/Default/Bookmarks"},
      {"brave", "Brave", "BraveSoftware/Brave-Browser/Default/Bookmarks"},
      {"arc", "Arc", "Arc/User Data/Default/Bookmarks"},
      {"vivaldi", "Vivaldi", "Vivaldi/Default/Bookmarks"},
      {"chromium", "Chromium", "Chromium/Default/Bookmarks"},
  };
#else
  const std::string base = JoinPath(HomeDir(), ".config");
  static const Source kSources[] = {
      {"chrome", "Google Chrome", "google-chrome/Default/Bookmarks"},
      {"chromium", "Chromium", "chromium/Default/Bookmarks"},
      {"edge", "Microsoft Edge", "microsoft-edge/Default/Bookmarks"},
      {"brave", "Brave", "BraveSoftware/Brave-Browser/Default/Bookmarks"},
      {"vivaldi", "Vivaldi", "vivaldi/Default/Bookmarks"},
  };
#endif
  CefRefPtr<CefListValue> list = CefListValue::Create();
  for (const auto& source : kSources) {
    std::string data;
    const std::string path = JoinPath(base, source.path);
    if (!ReadFile(path, &data)) continue;
    auto d = NewDict();
    d->SetString("id", source.id);
    d->SetString("name", source.name);
    d->SetString("bookmarks", data);
    list->SetDictionary(list->GetSize(), d);
  }
  CefRefPtr<CefValue> v = CefValue::Create();
  v->SetList(list);
  ReplyJson(cb, v);
}

void SiftWindow::FetchText(const std::string& url, QueryCallback cb) {
  if (!IsWebUrl(url)) return cb->Failure(400, "bad url");
  CefRefPtr<CefRequest> request = CefRequest::Create();
  request->SetURL(url);
  request->SetMethod("GET");
  // No cookies or stored credentials: suggestion requests carry only the query.
  request->SetFlags(UR_FLAG_DISABLE_CACHE);
  CefURLRequest::Create(request, new TextRequestClient(cb), context_);
}

void SiftWindow::FileDialog(Args args, QueryCallback cb) {
  if (!ui_browser_) return cb->Failure(500, "no ui");
  const bool save = StringArg(args, "mode") == "save" || BoolArg(args, "save");
  std::vector<CefString> filters;
  if (CefRefPtr<CefListValue> list = args->GetList("filters")) {
    for (size_t i = 0; i < list->GetSize(); ++i) filters.push_back(list->GetString(i));
  }
  const std::string content = StringArg(args, "content");
  std::string default_path = StringArg(args, "name");
  if (save && !default_path.empty()) default_path = JoinPath(DownloadsDir(), default_path);
  ui_browser_->GetHost()->RunFileDialog(
      save ? FILE_DIALOG_SAVE : FILE_DIALOG_OPEN, StringArg(args, "title"), default_path, filters,
      new DialogCallback([cb, save, content](const std::vector<CefString>& paths) {
        if (paths.empty()) return cb->Success("null");
        const std::string path = paths.front().ToString();
        auto d = NewDict();
        d->SetString("path", path);
        if (save) {
          d->SetBool("ok", WriteFileAtomic(path, content));
        } else {
          std::string data;
          if (!ReadFile(path, &data) || data.size() > 32 * 1024 * 1024) return cb->Failure(500, "unreadable");
          d->SetString("content", data);
        }
        CefRefPtr<CefValue> v = CefValue::Create();
        v->SetDictionary(d);
        cb->Success(ToJson(v));
      }));
}

void SiftWindow::SetPref(Args args, QueryCallback cb) {
  const std::string name = StringArg(args, "name");
  // A short allow-list: the UI cannot flip arbitrary Chromium preferences.
  static const char* kAllowed[] = {"enable_do_not_track", "profile.cookie_controls_mode",
                                   "profile.default_content_setting_values.cookies"};
  if (std::find_if(std::begin(kAllowed), std::end(kAllowed), [&](const char* a) { return name == a; }) ==
      std::end(kAllowed)) {
    return cb->Failure(403, "pref not allowed");
  }
  CefRefPtr<CefValue> value = args->GetValue("value");
  CefString error;
  if (!value || !context_->CanSetPreference(name)) return cb->Failure(500, "pref unavailable");
  if (!context_->SetPreference(name, value, error)) return cb->Failure(500, error.ToString());
  cb->Success("true");
}

void SiftWindow::ClearData(Args args, QueryCallback cb) {
  if (BoolArg(args, "cookies")) {
    context_->GetCookieManager(nullptr)->DeleteCookies("", "", nullptr);
  }
  if (BoolArg(args, "cache") && ui_browser_) {
    ui_browser_->GetHost()->ExecuteDevToolsMethod(0, "Network.clearBrowserCache", nullptr);
  }
  cb->Success("true");
}

}  // namespace sift
