#include "clients.h"

#include "include/cef_parser.h"
#include "include/wrapper/cef_closure_task.h"
#include "include/wrapper/cef_helpers.h"
#include "include/base/cef_callback.h"
#include "scheme.h"
#include "trackers.h"
#include "util.h"
#include "window.h"

namespace sift {

namespace {

enum MenuIds {
  kMenuOpenLinkInTab = MENU_ID_USER_FIRST,
  kMenuOpenLinkSideBySide,
  kMenuSearchSelection,
  kMenuSaveMoment,
};

#if defined(__APPLE__)
constexpr uint32_t kPrimary = EVENTFLAG_COMMAND_DOWN;
#else
constexpr uint32_t kPrimary = EVENTFLAG_CONTROL_DOWN;
#endif

// Maps a key event to one of Sift's browser shortcuts. The UI owns the
// behaviour; the host only forwards the name so focus inside a web page never
// swallows a browser shortcut.
std::string ShortcutFor(const CefKeyEvent& e) {
  if (e.type != KEYEVENT_RAWKEYDOWN) return "";
  const int k = e.windows_key_code;
  const bool primary = (e.modifiers & kPrimary) != 0;
  const bool shift = (e.modifiers & EVENTFLAG_SHIFT_DOWN) != 0;
  const bool alt = (e.modifiers & EVENTFLAG_ALT_DOWN) != 0;
  const bool ctrl = (e.modifiers & EVENTFLAG_CONTROL_DOWN) != 0;

  if (k == 0x74 /*F5*/) return shift ? "hardReload" : "reload";
  if (k == 0x7A /*F11*/) return "toggleFullscreen";
  if (k == 0x7B /*F12*/) return "devtools";
  if (ctrl && k == 0x09 /*Tab*/) return shift ? "prevTab" : "nextTab";
  if (alt && !primary && k == 0x25) return "back";
  if (alt && !primary && k == 0x27) return "forward";
  if (!primary) return "";

  if (k >= 0x31 && k <= 0x39 && !shift) return "tab" + std::to_string(k - 0x30);
  switch (k) {
    case 'L': return "focusAddress";
    case 'K': return "command";
    case 'T': return shift ? "reopenTab" : "newTab";
    case 'W': return shift ? "closeWindow" : "closeTab";
    case 'N': return shift ? "privateWindow" : "newWindow";
    case 'A': return shift ? "tabSearch" : "";
    case 'S': return shift ? "saveMoment" : "";
    case 'D': return "bookmark";
    case 'F': return "find";
    case 'G': return shift ? "findPrev" : "findNext";
    case 'R': return shift ? "hardReload" : "reload";
    case 'J': return "downloads";
    case 'Y': return "history";
    case 'H': return "history";
    case 'P': return "print";
    case 'I': return shift ? "devtools" : "";
    case 'U': return "viewSource";
    case 0xBB: return "zoomIn";     // = / +
    case 0xBD: return "zoomOut";    // -
    case '0': return "zoomReset";
    case 0xDB: return "back";       // [
    case 0xDD: return "forward";    // ]
    case 0xBC: return "settings";   // ,
    case 0xDC: return "split";      // backslash
    case 0x25: return "back";
    case 0x27: return "forward";
  }
  return "";
}

CefRefPtr<CefListValue> PermissionKinds(uint32_t mask) {
  static const std::pair<uint32_t, const char*> kNames[] = {
      {CEF_PERMISSION_TYPE_GEOLOCATION, "location"},
      {CEF_PERMISSION_TYPE_NOTIFICATIONS, "notifications"},
      {CEF_PERMISSION_TYPE_CAMERA_STREAM, "camera"},
      {CEF_PERMISSION_TYPE_MIC_STREAM, "microphone"},
      {CEF_PERMISSION_TYPE_CLIPBOARD, "clipboard"},
      {CEF_PERMISSION_TYPE_MIDI_SYSEX, "midi"},
      {CEF_PERMISSION_TYPE_MULTIPLE_DOWNLOADS, "downloads"},
      {CEF_PERMISSION_TYPE_WINDOW_MANAGEMENT, "windows"},
      {CEF_PERMISSION_TYPE_LOCAL_FONTS, "fonts"},
      {CEF_PERMISSION_TYPE_IDLE_DETECTION, "idle"},
      {CEF_PERMISSION_TYPE_STORAGE_ACCESS, "storage"},
      {CEF_PERMISSION_TYPE_TOP_LEVEL_STORAGE_ACCESS, "storage"},
      {CEF_PERMISSION_TYPE_FILE_SYSTEM_ACCESS, "files"},
      {CEF_PERMISSION_TYPE_SENSORS, "sensors"},
  };
  CefRefPtr<CefListValue> list = CefListValue::Create();
  uint32_t known = 0;
  for (const auto& [bit, name] : kNames) {
    if (mask & bit) {
      list->SetString(list->GetSize(), name);
      known |= bit;
    }
  }
  if (mask & ~known) list->SetString(list->GetSize(), "other");
  return list;
}

class FaviconCallback : public CefDownloadImageCallback {
 public:
  FaviconCallback(CefRefPtr<SiftWindow> window, std::string tab_id) : window_(window), tab_id_(std::move(tab_id)) {}
  void OnDownloadImageFinished(const CefString& image_url, int http_status_code, CefRefPtr<CefImage> image) override {
    if (!image || image->IsEmpty()) return;
    int w = 0, h = 0;
    CefRefPtr<CefBinaryValue> png = image->GetAsPNG(2.0f, true, w, h);
    if (!png) png = image->GetAsPNG(1.0f, true, w, h);
    if (!png) return;
    std::string bytes(png->GetSize(), '\0');
    png->GetData(bytes.data(), bytes.size(), 0);
    auto d = NewDict();
    d->SetString("favicon", "data:image/png;base64," + CefBase64Encode(bytes.data(), bytes.size()).ToString());
    window_->EmitTab(tab_id_, d);
  }

 private:
  CefRefPtr<SiftWindow> window_;
  std::string tab_id_;
  IMPLEMENT_REFCOUNTING(FaviconCallback);
};

}  // namespace

ContentClient::ContentClient(CefRefPtr<SiftWindow> window, const std::string& tab_id)
    : window_(window), tab_id_(tab_id) {}

void ContentClient::Emit(CefRefPtr<CefDictionaryValue> data) {
  if (window_) window_->EmitTab(tab_id_, data);
}

// --- Focus ------------------------------------------------------------------

void ContentClient::OnGotFocus(CefRefPtr<CefBrowser> browser) {
  if (!window_) return;
  auto d = NewDict();
  d->SetString("id", tab_id_);
  window_->Emit("tab.focused", d);
}

// --- Display ----------------------------------------------------------------

void ContentClient::OnAddressChange(CefRefPtr<CefBrowser> browser, CefRefPtr<CefFrame> frame, const CefString& url) {
  if (!frame->IsMain()) return;
  {
    std::lock_guard<std::mutex> guard(lock_);
    page_host_ = HostOf(url);
  }
  auto d = NewDict();
  d->SetString("url", url);
  Emit(d);
}

void ContentClient::OnTitleChange(CefRefPtr<CefBrowser> browser, const CefString& title) {
  auto d = NewDict();
  d->SetString("title", title);
  Emit(d);
}

void ContentClient::OnFaviconURLChange(CefRefPtr<CefBrowser> browser, const std::vector<CefString>& icon_urls) {
  if (icon_urls.empty() || !window_) return;
  const std::string url = icon_urls.front().ToString();
  if (url == last_favicon_) return;
  last_favicon_ = url;
  // Download through the page's own browser so the request uses the tab's
  // context; the UI only ever receives a data: URL.
  browser->GetHost()->DownloadImage(url, true, 32, false, new FaviconCallback(window_, tab_id_));
}

void ContentClient::OnFullscreenModeChange(CefRefPtr<CefBrowser> browser, bool fullscreen) {
  if (window_) window_->OnFullscreenRequest(tab_id_, fullscreen);
}

void ContentClient::OnStatusMessage(CefRefPtr<CefBrowser> browser, const CefString& value) {
  if (window_) window_->OnStatusText(tab_id_, value.ToString());
}

void ContentClient::OnLoadingProgressChange(CefRefPtr<CefBrowser> browser, double progress) {
  auto d = NewDict();
  d->SetDouble("progress", progress);
  Emit(d);
}

void ContentClient::OnMediaAccessChange(CefRefPtr<CefBrowser> browser, bool has_video_access, bool has_audio_access) {
  auto d = NewDict();
  d->SetBool("camera", has_video_access);
  d->SetBool("microphone", has_audio_access);
  Emit(d);
}

// --- Load -------------------------------------------------------------------

void ContentClient::OnLoadingStateChange(CefRefPtr<CefBrowser> browser, bool isLoading, bool canGoBack,
                                         bool canGoForward) {
  auto d = NewDict();
  d->SetBool("loading", isLoading);
  d->SetBool("canBack", canGoBack);
  d->SetBool("canForward", canGoForward);
  if (!isLoading) {
    CefRefPtr<CefNavigationEntry> entry = browser->GetHost()->GetVisibleNavigationEntry();
    if (entry) {
      CefRefPtr<CefSSLStatus> ssl = entry->GetSSLStatus();
      d->SetBool("secure", ssl && ssl->IsSecureConnection());
      d->SetBool("certError", ssl && (ssl->GetCertStatus() & (CERT_STATUS_COMMON_NAME_INVALID | CERT_STATUS_DATE_INVALID | CERT_STATUS_AUTHORITY_INVALID | CERT_STATUS_REVOKED | CERT_STATUS_INVALID)) != 0);
    }
  }
  Emit(d);
}

void ContentClient::OnLoadStart(CefRefPtr<CefBrowser> browser, CefRefPtr<CefFrame> frame,
                                TransitionType transition_type) {
  if (!frame->IsMain()) return;
  {
    std::lock_guard<std::mutex> guard(lock_);
    blocked_domains_.clear();
    blocked_count_ = 0;
  }
  auto d = NewDict();
  d->SetInt("blocked", 0);
  d->SetList("blockedDomains", CefListValue::Create());
  d->SetNull("error");
  Emit(d);
}

void ContentClient::OnLoadEnd(CefRefPtr<CefBrowser> browser, CefRefPtr<CefFrame> frame, int httpStatusCode) {
  if (frame->IsMain() && window_) window_->OnTabLoadEnd(tab_id_);
}

void ContentClient::OnLoadError(CefRefPtr<CefBrowser> browser, CefRefPtr<CefFrame> frame, ErrorCode errorCode,
                                const CefString& errorText, const CefString& failedUrl) {
  if (!frame->IsMain() || errorCode == ERR_ABORTED) return;
  auto err = NewDict();
  err->SetInt("code", errorCode);
  err->SetString("text", errorText);
  err->SetString("url", failedUrl);
  auto d = NewDict();
  d->SetDictionary("error", err);
  Emit(d);
}

// --- Life span --------------------------------------------------------------

bool ContentClient::OnBeforePopup(CefRefPtr<CefBrowser> browser, CefRefPtr<CefFrame> frame, int popup_id,
                                  const CefString& target_url, const CefString& target_frame_name,
                                  CefLifeSpanHandler::WindowOpenDisposition target_disposition, bool user_gesture,
                                  const CefPopupFeatures& popupFeatures, CefWindowInfo& windowInfo,
                                  CefRefPtr<CefClient>& client, CefBrowserSettings& settings,
                                  CefRefPtr<CefDictionaryValue>& extra_info, bool* no_javascript_access) {
  if (!window_) return true;
  // Popups are created by CEF (keeping window.opener working) and adopted in
  // OnPopupBrowserViewCreated. Each one gets its own client and tab id.
  const std::string id = window_->ReservePopup(browser->GetIdentifier(), target_disposition, target_url);
  client = window_->NewContentClient(id);
  return false;
}

void ContentClient::OnAfterCreated(CefRefPtr<CefBrowser> browser) {
  if (window_) window_->OnTabBrowserCreated(tab_id_, browser);
}

bool ContentClient::DoClose(CefRefPtr<CefBrowser> browser) {
  // Returning false would ask the top-level window to close. That's only
  // right when the window itself is closing; closing a tab closes just it.
  return window_ && !window_->is_closing();
}

void ContentClient::OnBeforeClose(CefRefPtr<CefBrowser> browser) {
  if (window_) window_->OnTabBrowserClosed(tab_id_);
  window_ = nullptr;
}

// --- Keyboard ---------------------------------------------------------------

bool ContentClient::OnPreKeyEvent(CefRefPtr<CefBrowser> browser, const CefKeyEvent& event, CefEventHandle os_event,
                                  bool* is_keyboard_shortcut) {
  const std::string name = ShortcutFor(event);
  if (name.empty() || !window_) return false;
  window_->OnShortcut(name);
  return true;
}

// --- Downloads --------------------------------------------------------------

bool ContentClient::OnBeforeDownload(CefRefPtr<CefBrowser> browser, CefRefPtr<CefDownloadItem> item,
                                     const CefString& suggested_name, CefRefPtr<CefBeforeDownloadCallback> callback) {
  const std::string dir = DownloadsDir();
  MakeDirs(dir);
  callback->Continue(UniquePath(dir, suggested_name.ToString()), false);
  return true;
}

void ContentClient::OnDownloadUpdated(CefRefPtr<CefBrowser> browser, CefRefPtr<CefDownloadItem> item,
                                      CefRefPtr<CefDownloadItemCallback> callback) {
  if (!window_ || !item->IsValid()) return;
  window_->RegisterDownload(item->GetId(), callback);
  auto d = NewDict();
  d->SetInt("id", static_cast<int>(item->GetId()));
  d->SetString("url", item->GetURL());
  d->SetString("path", item->GetFullPath());
  std::string name = item->GetFullPath().ToString();
  const size_t slash = name.find_last_of("/\\");
  if (slash != std::string::npos) name = name.substr(slash + 1);
  if (name.empty()) name = item->GetSuggestedFileName().ToString();
  d->SetString("name", name);
  d->SetString("mime", item->GetMimeType());
  d->SetDouble("received", static_cast<double>(item->GetReceivedBytes()));
  d->SetDouble("total", static_cast<double>(item->GetTotalBytes()));
  d->SetDouble("speed", static_cast<double>(item->GetCurrentSpeed()));
  d->SetInt("percent", item->GetPercentComplete());
  d->SetString("state", item->IsComplete()      ? "complete"
                        : item->IsCanceled()    ? "canceled"
                        : item->IsInterrupted() ? "interrupted"
                        : item->IsPaused()      ? "paused"
                                                : "progress");
  d->SetString("tabId", tab_id_);
  window_->Emit("download", d);
}

// --- Permissions ------------------------------------------------------------

bool ContentClient::OnShowPermissionPrompt(CefRefPtr<CefBrowser> browser, uint64_t prompt_id,
                                           const CefString& requesting_origin, uint32_t requested_permissions,
                                           CefRefPtr<CefPermissionPromptCallback> callback) {
  if (!window_) return false;
  window_->RegisterPermissionCallback(prompt_id, [callback](const std::string& result) {
    callback->Continue(result == "allow"  ? CEF_PERMISSION_RESULT_ACCEPT
                       : result == "deny" ? CEF_PERMISSION_RESULT_DENY
                                          : CEF_PERMISSION_RESULT_DISMISS);
  });
  auto d = NewDict();
  d->SetString("promptId", std::to_string(prompt_id));
  d->SetString("tabId", tab_id_);
  d->SetString("origin", requesting_origin);
  d->SetList("kinds", PermissionKinds(requested_permissions));
  window_->Emit("permission", d);
  return true;
}

bool ContentClient::OnRequestMediaAccessPermission(CefRefPtr<CefBrowser> browser, CefRefPtr<CefFrame> frame,
                                                   const CefString& requesting_origin, uint32_t requested_permissions,
                                                   CefRefPtr<CefMediaAccessCallback> callback) {
  if (!window_) return false;
  // Media prompts share the permission prompt UI; ids are namespaced with "m".
  static uint64_t next_media_id = 1;
  const uint64_t id = (1ull << 62) | next_media_id++;
  window_->RegisterPermissionCallback(id, [callback, requested_permissions](const std::string& result) {
    if (result == "allow") callback->Continue(requested_permissions);
    else callback->Cancel();
  });
  uint32_t mask = 0;
  if (requested_permissions & CEF_MEDIA_PERMISSION_DEVICE_AUDIO_CAPTURE) mask |= CEF_PERMISSION_TYPE_MIC_STREAM;
  if (requested_permissions & CEF_MEDIA_PERMISSION_DEVICE_VIDEO_CAPTURE) mask |= CEF_PERMISSION_TYPE_CAMERA_STREAM;
  auto d = NewDict();
  d->SetString("promptId", std::to_string(id));
  d->SetString("tabId", tab_id_);
  d->SetString("origin", requesting_origin);
  CefRefPtr<CefListValue> kinds = PermissionKinds(mask);
  if (requested_permissions & (CEF_MEDIA_PERMISSION_DESKTOP_AUDIO_CAPTURE | CEF_MEDIA_PERMISSION_DESKTOP_VIDEO_CAPTURE))
    kinds->SetString(kinds->GetSize(), "screen");
  d->SetList("kinds", kinds);
  window_->Emit("permission", d);
  return true;
}

// --- Requests ---------------------------------------------------------------

bool ContentClient::OnBeforeBrowse(CefRefPtr<CefBrowser> browser, CefRefPtr<CefFrame> frame,
                                   CefRefPtr<CefRequest> request, bool user_gesture, bool is_redirect) {
  const std::string url = request->GetURL().ToString();
  // Web content may never load Sift's own UI or its internal pages. Typed
  // sift:// addresses are handled by the UI before they reach a tab.
  if (url.rfind("sift:", 0) == 0) {
    if (frame->IsMain() && user_gesture && window_) {
      auto d = NewDict();
      d->SetString("url", url);
      d->SetString("tabId", tab_id_);
      window_->Emit("internalNavigation", d);
    }
    return true;
  }
  return false;
}

CefRefPtr<CefResourceRequestHandler> ContentClient::GetResourceRequestHandler(
    CefRefPtr<CefBrowser> browser, CefRefPtr<CefFrame> frame, CefRefPtr<CefRequest> request, bool is_navigation,
    bool is_download, const CefString& request_initiator, bool& disable_default_handling) {
  return this;
}

CefResourceRequestHandler::ReturnValue ContentClient::OnBeforeResourceLoad(CefRefPtr<CefBrowser> browser,
                                                                           CefRefPtr<CefFrame> frame,
                                                                           CefRefPtr<CefRequest> request,
                                                                           CefRefPtr<CefCallback> callback) {
  // IO thread.
  if (request->GetResourceType() == RT_MAIN_FRAME) return RV_CONTINUE;
  const std::string host = HostOf(request->GetURL().ToString());
  std::string page_host;
  {
    std::lock_guard<std::mutex> guard(lock_);
    page_host = page_host_;
  }
  const std::string matched = TrackerList::Get().Match(host, page_host);
  if (matched.empty()) return RV_CONTINUE;
  bool report = false;
  {
    std::lock_guard<std::mutex> guard(lock_);
    ++blocked_count_;
    // Report each new domain plus every 10th request, to keep UI traffic low
    // on ad-heavy pages.
    report = blocked_domains_.insert(matched).second || blocked_count_ % 10 == 0;
  }
  if (report) {
    CefPostTask(TID_UI, base::BindOnce(&ContentClient::EmitBlocked, this));
  }
  return RV_CANCEL;
}

void ContentClient::EmitBlocked() {
  auto d = NewDict();
  CefRefPtr<CefListValue> domains = CefListValue::Create();
  {
    std::lock_guard<std::mutex> guard(lock_);
    d->SetInt("blocked", blocked_count_);
    for (const auto& domain : blocked_domains_) domains->SetString(domains->GetSize(), domain);
  }
  d->SetList("blockedDomains", domains);
  Emit(d);
}

void ContentClient::OnRenderProcessTerminated(CefRefPtr<CefBrowser> browser, TerminationStatus status,
                                              int error_code, const CefString& error_string) {
  auto d = NewDict();
  d->SetBool("crashed", true);
  d->SetBool("loading", false);
  Emit(d);
}

// --- Find -------------------------------------------------------------------

void ContentClient::OnFindResult(CefRefPtr<CefBrowser> browser, int identifier, int count,
                                 const CefRect& selectionRect, int activeMatchOrdinal, bool finalUpdate) {
  if (!window_) return;
  auto d = NewDict();
  d->SetString("tabId", tab_id_);
  d->SetInt("count", count);
  d->SetInt("active", activeMatchOrdinal);
  d->SetBool("final", finalUpdate);
  window_->Emit("find", d);
}

// --- Context menu -----------------------------------------------------------

void ContentClient::OnBeforeContextMenu(CefRefPtr<CefBrowser> browser, CefRefPtr<CefFrame> frame,
                                        CefRefPtr<CefContextMenuParams> params, CefRefPtr<CefMenuModel> model) {
  const int flags = params->GetTypeFlags();
  if ((flags & CM_TYPEFLAG_LINK) && !params->GetLinkUrl().empty()) {
    model->InsertItemAt(0, kMenuOpenLinkInTab, "Open Link in New Tab");
    model->InsertItemAt(1, kMenuOpenLinkSideBySide, "Open Link Side by Side");
    model->InsertSeparatorAt(2);
  }
  if ((flags & CM_TYPEFLAG_SELECTION) && !params->GetSelectionText().empty()) {
    std::string text = params->GetSelectionText().ToString();
    if (text.size() > 32) text = text.substr(0, 30) + "…";
    model->AddSeparator();
    model->AddItem(kMenuSearchSelection, "Search for “" + text + "”");
  }
  if (flags == CM_TYPEFLAG_PAGE || flags == CM_TYPEFLAG_FRAME) {
    model->AddSeparator();
    model->AddItem(kMenuSaveMoment, "Save Tabs as Moment…");
  }
}

bool ContentClient::OnContextMenuCommand(CefRefPtr<CefBrowser> browser, CefRefPtr<CefFrame> frame,
                                         CefRefPtr<CefContextMenuParams> params, int command_id,
                                         EventFlags event_flags) {
  if (!window_) return false;
  auto d = NewDict();
  d->SetString("tabId", tab_id_);
  switch (command_id) {
    case kMenuOpenLinkInTab:
      d->SetString("action", "openTab");
      d->SetString("url", params->GetLinkUrl());
      break;
    case kMenuOpenLinkSideBySide:
      d->SetString("action", "openSideBySide");
      d->SetString("url", params->GetLinkUrl());
      break;
    case kMenuSearchSelection:
      d->SetString("action", "search");
      d->SetString("text", params->GetSelectionText());
      break;
    case kMenuSaveMoment:
      d->SetString("action", "saveMoment");
      break;
    default:
      return false;
  }
  window_->Emit("contextAction", d);
  return true;
}

// --- UI client --------------------------------------------------------------

UiClient::UiClient(CefRefPtr<SiftWindow> window) : window_(window) {}

bool UiClient::OnProcessMessageReceived(CefRefPtr<CefBrowser> browser, CefRefPtr<CefFrame> frame,
                                        CefProcessId source_process, CefRefPtr<CefProcessMessage> message) {
  return window_ && window_->router()->OnProcessMessageReceived(browser, frame, source_process, message);
}

void UiClient::OnAfterCreated(CefRefPtr<CefBrowser> browser) {
  if (window_) window_->OnUiBrowserCreated(browser);
}

void UiClient::OnBeforeClose(CefRefPtr<CefBrowser> browser) {
  if (!window_) return;
  window_->router()->OnBeforeClose(browser);
  window_->OnUiBrowserClosed();
  window_ = nullptr;
}

bool UiClient::OnBeforeBrowse(CefRefPtr<CefBrowser> browser, CefRefPtr<CefFrame> frame,
                              CefRefPtr<CefRequest> request, bool user_gesture, bool is_redirect) {
  // The UI browser only ever shows Sift's own pages.
  const std::string url = request->GetURL().ToString();
  if (frame->IsMain() && url.rfind(kAppOrigin, 0) != 0) return true;
  if (window_) window_->router()->OnBeforeBrowse(browser, frame);
  return false;
}

void UiClient::OnRenderProcessTerminated(CefRefPtr<CefBrowser> browser, TerminationStatus status, int error_code,
                                         const CefString& error_string) {
  if (!window_) return;
  window_->router()->OnRenderProcessTerminated(browser);
  // Reload the UI; it restores tabs from the host on "ready".
  browser->Reload();
}

void UiClient::OnDraggableRegionsChanged(CefRefPtr<CefBrowser> browser, CefRefPtr<CefFrame> frame,
                                         const std::vector<CefDraggableRegion>& regions) {
  if (window_) window_->OnDraggableRegions(regions);
}

void UiClient::OnBeforeContextMenu(CefRefPtr<CefBrowser> browser, CefRefPtr<CefFrame> frame,
                                   CefRefPtr<CefContextMenuParams> params, CefRefPtr<CefMenuModel> model) {
  // The UI draws its own menus. Keep only the editing items for text fields.
  if (!(params->GetTypeFlags() & CM_TYPEFLAG_EDITABLE)) model->Clear();
}

bool UiClient::OnConsoleMessage(CefRefPtr<CefBrowser> browser, cef_log_severity_t level, const CefString& message,
                                const CefString& source, int line) {
  if (level >= LOGSEVERITY_WARNING) {
    LOG(WARNING) << "[ui] " << message.ToString() << " (" << source.ToString() << ":" << line << ")";
  }
  return false;
}

}  // namespace sift
