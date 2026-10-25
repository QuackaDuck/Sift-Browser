// One Sift browser window.
//
// Layout (CEF Views):
//
//   CefWindow (frameless, vertical BoxLayout)
//   ├── chrome spacer   fixed height = UI strip height reported by the UI
//   └── content panel   horizontal BoxLayout: [pane A] [divider] [pane B]
//                       one CefBrowserView per tab, only visible panes shown
//   └── overlay: UI browser (sift://app/index.html), CEF_DOCKING_MODE_CUSTOM
//
// The UI browser is an overlay so it can grow over web content for menus,
// the address bar dropdown, tab search and previews. CEF Views cannot make a
// windowed browser transparent, so before growing ("cover" mode) the host
// captures the visible panes and the UI paints them as its backdrop.
#ifndef SIFT_WINDOW_H_
#define SIFT_WINDOW_H_

#include <functional>
#include <map>
#include <memory>
#include <set>
#include <string>
#include <vector>

#include "include/cef_devtools_message_observer.h"
#include "include/cef_request_context.h"
#include "include/views/cef_box_layout.h"
#include "include/views/cef_browser_view.h"
#include "include/views/cef_label_button.h"
#include "include/views/cef_panel.h"
#include "include/views/cef_window.h"
#include "include/wrapper/cef_message_router.h"
#include "clients.h"

namespace sift {

struct WindowOptions {
  std::string profile = "Default";
  bool incognito = false;
  std::vector<std::string> open_urls;
};

class SiftWindow : public CefWindowDelegate, public CefMessageRouterBrowserSide::Handler {
 public:
  using QueryCallback = CefRefPtr<CefMessageRouterBrowserSide::Callback>;

  static void Open(const WindowOptions& options);
  static SiftWindow* ForBrowser(int browser_id);

  explicit SiftWindow(const WindowOptions& options);

  // --- Events sent to the UI ------------------------------------------------
  void Emit(const std::string& type, CefRefPtr<CefDictionaryValue> data);
  void EmitTab(const std::string& tab_id, CefRefPtr<CefDictionaryValue> data);

  // --- Called by ContentClient ---------------------------------------------
  void OnTabBrowserCreated(const std::string& tab_id, CefRefPtr<CefBrowser> browser);
  void OnTabBrowserClosed(const std::string& tab_id);
  void OnTabLoadEnd(const std::string& tab_id);
  void OnShortcut(const std::string& name);
  void OnFullscreenRequest(const std::string& tab_id, bool fullscreen);
  void OnStatusText(const std::string& tab_id, const std::string& text);
  void OnDraggableRegions(const std::vector<CefDraggableRegion>& regions);
  // Records the disposition of a popup about to be created so that
  // OnPopupBrowserViewCreated knows whether to adopt it as a tab.
  std::string ReservePopup(int opener_browser_id, int disposition, const std::string& url);
  bool AdoptPopup(CefRefPtr<CefBrowserView> opener, CefRefPtr<CefBrowserView> popup);
  void RegisterPermissionCallback(uint64_t id, std::function<void(const std::string&)> cb);
  void RegisterDownload(uint32_t id, CefRefPtr<CefDownloadItemCallback> cb);
  CefRefPtr<ContentClient> NewContentClient(const std::string& tab_id);
  bool IsUiBrowser(CefRefPtr<CefBrowser> browser) const;
  bool incognito() const { return options_.incognito; }
  bool is_closing() const { return closing_; }

  // --- Called by UiClient --------------------------------------------------
  void OnUiBrowserCreated(CefRefPtr<CefBrowser> browser);
  void OnUiBrowserClosed();
  CefRefPtr<CefMessageRouterBrowserSide> router() { return router_; }

  // --- CefMessageRouterBrowserSide::Handler --------------------------------
  bool OnQuery(CefRefPtr<CefBrowser> browser, CefRefPtr<CefFrame> frame, int64_t query_id, const CefString& request,
               bool persistent, QueryCallback callback) override;

  // --- CefWindowDelegate ---------------------------------------------------
  void OnWindowCreated(CefRefPtr<CefWindow> window) override;
  void OnWindowDestroyed(CefRefPtr<CefWindow> window) override;
  void OnWindowBoundsChanged(CefRefPtr<CefWindow> window, const CefRect& new_bounds) override;
  void OnWindowActivationChanged(CefRefPtr<CefWindow> window, bool active) override;
  void OnLayoutChanged(CefRefPtr<CefView> view, const CefRect& new_bounds) override;
  bool CanClose(CefRefPtr<CefWindow> window) override;
  CefRect GetInitialBounds(CefRefPtr<CefWindow> window) override;
  bool IsFrameless(CefRefPtr<CefWindow> window) override { return true; }
  bool WithStandardWindowButtons(CefRefPtr<CefWindow> window) override { return true; }
  bool GetTitlebarHeight(CefRefPtr<CefWindow> window, float* titlebar_height) override;
  CefSize GetMinimumSize(CefRefPtr<CefView> view) override { return CefSize(480, 320); }
  cef_runtime_style_t GetWindowRuntimeStyle() override { return CEF_RUNTIME_STYLE_ALLOY; }
  bool OnKeyEvent(CefRefPtr<CefWindow> window, const CefKeyEvent& event) override;

 private:
  struct Tab {
    std::string id;
    CefRefPtr<CefBrowserView> view;
    CefRefPtr<CefBrowser> browser;
    CefRefPtr<CefRegistration> devtools_registration;
    std::string pending_url;  // URL to load when a lazy/discarded tab is shown
    double zoom = 0;
    int restore_scroll = -1;
    bool closing = false;
    bool discarding = false;
  };
  struct PendingPopup {
    std::string tab_id;
    int disposition;
  };
  using Args = CefRefPtr<CefDictionaryValue>;

  bool Dispatch(const std::string& cmd, Args args, QueryCallback cb);
  Tab* FindTab(const std::string& id);
  Tab* TabForBrowser(int browser_id);
  void CreateTabBrowser(const std::string& id, const std::string& url);
  void CloseTab(const std::string& id);
  void ApplyLayout();
  void ApplySurface();
  void SetSurface(const std::string& mode);
  void CaptureVisible(std::function<void(CefRefPtr<CefListValue>)> done);
  void Capture(Tab* tab, double scale, int quality, std::function<void(const std::string&)> done);
  void EnsureBrowser(Tab* tab);
  void Evaluate(Tab* tab, const std::string& expression, std::function<void(CefRefPtr<CefValue>)> done);
  int DevTools(Tab* tab, const std::string& method, CefRefPtr<CefDictionaryValue> params,
               std::function<void(bool, CefRefPtr<CefDictionaryValue>)> done);
  void FocusUi();
  void ReplyJson(QueryCallback cb, CefRefPtr<CefValue> value);
  void StoreRead(Args args, QueryCallback cb);
  void StoreWrite(Args args, QueryCallback cb);
  void ImportSources(QueryCallback cb);
  void FetchText(const std::string& url, QueryCallback cb);
  void FileDialog(Args args, QueryCallback cb);
  void SetPref(Args args, QueryCallback cb);
  void ClearData(Args args, QueryCallback cb);
  std::string AppUrl() const;
  void MaybeFinishClose();

  WindowOptions options_;
  std::string window_id_;
  CefRefPtr<CefRequestContext> context_;
  CefRefPtr<CefWindow> window_;
  CefRefPtr<CefPanel> spacer_;
  CefRefPtr<CefPanel> content_;
  CefRefPtr<CefPanel> divider_;
  CefRefPtr<CefBoxLayout> window_layout_;
  CefRefPtr<CefBoxLayout> content_layout_;
  CefRefPtr<CefLabelButton> status_;
  CefRefPtr<CefOverlayController> status_overlay_;
  CefRefPtr<CefBrowserView> ui_view_;
  CefRefPtr<CefBrowser> ui_browser_;
  CefRefPtr<CefOverlayController> ui_overlay_;
  CefRefPtr<UiClient> ui_client_;
  CefRefPtr<CefMessageRouterBrowserSide> router_;

  std::map<std::string, Tab> tabs_;
  std::vector<std::string> panes_;       // visible tab ids, left to right
  std::string focused_pane_;
  std::string fullscreen_tab_;
  double ratio_ = 0.5;
  int chrome_height_ = 80;
  std::string surface_ = "strip";        // strip | cover | full
  std::map<int, std::vector<PendingPopup>> pending_popups_;
  std::set<std::string> popup_window_ids_;
  std::map<uint64_t, std::function<void(const std::string&)>> permission_callbacks_;
  std::map<uint32_t, CefRefPtr<CefDownloadItemCallback>> downloads_;
  std::map<int, std::function<void(bool, CefRefPtr<CefDictionaryValue>)>> devtools_pending_;
  int next_devtools_id_ = 1;
  int next_popup_id_ = 1;
  bool closing_ = false;
  bool ui_ready_ = false;

  friend class DevToolsObserver;
  IMPLEMENT_REFCOUNTING(SiftWindow);
};

}  // namespace sift

#endif  // SIFT_WINDOW_H_
