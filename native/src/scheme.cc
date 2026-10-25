#include "scheme.h"

#include "include/cef_parser.h"
#include "include/cef_stream.h"
#include "include/wrapper/cef_stream_resource_handler.h"
#include "util.h"

namespace sift {

namespace {

class AppSchemeHandlerFactory : public CefSchemeHandlerFactory {
 public:
  CefRefPtr<CefResourceHandler> Create(CefRefPtr<CefBrowser> browser,
                                       CefRefPtr<CefFrame> frame,
                                       const CefString& scheme_name,
                                       CefRefPtr<CefRequest> request) override {
    CefURLParts parts;
    if (!CefParseURL(request->GetURL(), parts)) return nullptr;
    std::string path = CefString(&parts.path).ToString();
    if (path.empty() || path == "/") path = "/index.html";
    // Reject anything that could walk out of the app directory.
    if (path.find("..") != std::string::npos || path.find('\\') != std::string::npos) return nullptr;

    const std::string file = ResourceDir() + "/app" + path;
    CefRefPtr<CefStreamReader> stream = CefStreamReader::CreateForFile(file);
    if (!stream) return nullptr;

    const size_t dot = path.find_last_of('.');
    std::string mime = dot == std::string::npos ? "" : CefGetMimeType(path.substr(dot + 1)).ToString();
    if (path.size() > 3 && path.compare(path.size() - 3, 3, ".js") == 0) mime = "text/javascript";
    if (mime.empty()) mime = "application/octet-stream";

    CefResponse::HeaderMap headers;
    headers.insert({"Cache-Control", "no-cache"});
    headers.insert({"Content-Security-Policy",
                    "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; "
                    "connect-src 'none'; frame-src 'none'; object-src 'none'"});
    return new CefStreamResourceHandler(200, "OK", mime, headers, stream);
  }

  IMPLEMENT_REFCOUNTING(AppSchemeHandlerFactory);
};

}  // namespace

CefRefPtr<CefSchemeHandlerFactory> AppSchemeFactory() {
  static CefRefPtr<CefSchemeHandlerFactory> factory = new AppSchemeHandlerFactory();
  return factory;
}

void RegisterSchemeHandlers() {
  CefRegisterSchemeHandlerFactory(kScheme, kAppHost, AppSchemeFactory());
}

}  // namespace sift
