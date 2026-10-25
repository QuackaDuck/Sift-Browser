// Serves the bundled Sift UI from sift://app/... out of <resources>/app.
#ifndef SIFT_SCHEME_H_
#define SIFT_SCHEME_H_

#include "include/cef_scheme.h"

namespace sift {

constexpr char kScheme[] = "sift";
constexpr char kAppHost[] = "app";
constexpr char kAppOrigin[] = "sift://app/";

void RegisterSchemeHandlers();
CefRefPtr<CefSchemeHandlerFactory> AppSchemeFactory();

}  // namespace sift

#endif  // SIFT_SCHEME_H_
