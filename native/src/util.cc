#include "util.h"

#include <cstdio>
#include <cstdlib>
#include <fstream>
#include <sstream>
#include <sys/stat.h>

#include "include/cef_parser.h"
#include "include/cef_path_util.h"

#if defined(_WIN32)
#include <direct.h>
#include <windows.h>
#include <shellapi.h>
#define SIFT_SEP "\\"
#else
#include <unistd.h>
#define SIFT_SEP "/"
#endif

namespace sift {

std::string JoinPath(const std::string& a, const std::string& b) {
  if (a.empty()) return b;
  if (a.back() == '/' || a.back() == '\\') return a + b;
  return a + SIFT_SEP + b;
}

std::string HomeDir() {
#if defined(_WIN32)
  const char* home = std::getenv("USERPROFILE");
#else
  const char* home = std::getenv("HOME");
#endif
  return home ? home : ".";
}

std::string ResourceDir() {
  CefString dir;
  if (!CefGetPath(PK_DIR_EXE, dir)) return ".";
#if defined(__APPLE__)
  // Sift.app/Contents/MacOS -> Sift.app/Contents/Resources. (PK_DIR_RESOURCES
  // is the CEF framework's own Resources folder, not the app bundle's.)
  return dir.ToString() + "/../Resources";
#else
  return dir.ToString();
#endif
}

std::string UserDataRoot() {
  if (const char* over = std::getenv("SIFT_USER_DATA")) return over;
#if defined(_WIN32)
  const char* local = std::getenv("LOCALAPPDATA");
  return JoinPath(JoinPath(local ? local : HomeDir(), "Sift"), "User Data");
#elif defined(__APPLE__)
  return JoinPath(HomeDir(), "Library/Application Support/Sift");
#else
  const char* xdg = std::getenv("XDG_CONFIG_HOME");
  return JoinPath(xdg && *xdg ? xdg : JoinPath(HomeDir(), ".config"), "sift");
#endif
}

std::string ProfileDir(const std::string& profile_id) {
  return JoinPath(JoinPath(UserDataRoot(), "Profiles"), profile_id);
}

std::string DownloadsDir() {
  if (const char* xdg = std::getenv("XDG_DOWNLOAD_DIR")) return xdg;
  return JoinPath(HomeDir(), "Downloads");
}

bool ReadFile(const std::string& path, std::string* out) {
  std::ifstream in(path, std::ios::binary);
  if (!in) return false;
  std::ostringstream ss;
  ss << in.rdbuf();
  *out = ss.str();
  return true;
}

bool WriteFileAtomic(const std::string& path, const std::string& data) {
  const std::string tmp = path + ".tmp";
  {
    std::ofstream out(tmp, std::ios::binary | std::ios::trunc);
    if (!out) return false;
    out.write(data.data(), static_cast<std::streamsize>(data.size()));
    if (!out.good()) return false;
  }
#if defined(_WIN32)
  return MoveFileExA(tmp.c_str(), path.c_str(), MOVEFILE_REPLACE_EXISTING) != 0;
#else
  return std::rename(tmp.c_str(), path.c_str()) == 0;
#endif
}

bool FileExists(const std::string& path) {
  struct stat st;
  return stat(path.c_str(), &st) == 0;
}

bool MakeDirs(const std::string& path) {
  if (path.empty() || FileExists(path)) return true;
  const size_t slash = path.find_last_of("/\\");
  if (slash != std::string::npos && slash > 0) MakeDirs(path.substr(0, slash));
#if defined(_WIN32)
  return _mkdir(path.c_str()) == 0 || FileExists(path);
#else
  return mkdir(path.c_str(), 0700) == 0 || FileExists(path);
#endif
}

std::string UniquePath(const std::string& dir, const std::string& name) {
  std::string base = name.empty() ? "download" : name;
  // Never let a server-suggested name escape the downloads folder.
  for (char& c : base) {
    if (c == '/' || c == '\\' || c == ':') c = '_';
  }
  if (base == "." || base == "..") base = "download";
  std::string candidate = JoinPath(dir, base);
  if (!FileExists(candidate)) return candidate;
  const size_t dot = base.find_last_of('.');
  const std::string stem = dot == std::string::npos || dot == 0 ? base : base.substr(0, dot);
  const std::string ext = dot == std::string::npos || dot == 0 ? "" : base.substr(dot);
  for (int i = 1; i < 1000; ++i) {
    candidate = JoinPath(dir, stem + " (" + std::to_string(i) + ")" + ext);
    if (!FileExists(candidate)) return candidate;
  }
  return candidate;
}

void OpenWithSystem(const std::string& path, bool reveal) {
#if defined(_WIN32)
  if (reveal) {
    std::string args = "/select,\"" + path + "\"";
    ShellExecuteA(nullptr, "open", "explorer.exe", args.c_str(), nullptr, SW_SHOWNORMAL);
  } else {
    ShellExecuteA(nullptr, "open", path.c_str(), nullptr, nullptr, SW_SHOWNORMAL);
  }
#else
  std::string target = path;
  if (reveal) {
    const size_t slash = path.find_last_of('/');
    if (slash != std::string::npos) target = path.substr(0, slash);
  }
  const pid_t pid = fork();
  if (pid == 0) {
#if defined(__APPLE__)
    if (reveal) execlp("open", "open", "-R", path.c_str(), static_cast<char*>(nullptr));
    execlp("open", "open", target.c_str(), static_cast<char*>(nullptr));
#else
    execlp("xdg-open", "xdg-open", target.c_str(), static_cast<char*>(nullptr));
#endif
    _exit(127);
  }
#endif
}

std::string ToJson(CefRefPtr<CefValue> value) {
  return CefWriteJSON(value, JSON_WRITER_DEFAULT).ToString();
}

CefRefPtr<CefDictionaryValue> NewDict() { return CefDictionaryValue::Create(); }

std::string HostOf(const std::string& url) {
  CefURLParts parts;
  if (!CefParseURL(url, parts)) return "";
  std::string host = CefString(&parts.host).ToString();
  for (char& c : host) c = static_cast<char>(tolower(static_cast<unsigned char>(c)));
  return host;
}

bool IsSafeKey(const std::string& key) {
  if (key.empty() || key.size() > 64) return false;
  for (char c : key) {
    if (!(isalnum(static_cast<unsigned char>(c)) || c == '-' || c == '_' || c == '.')) return false;
  }
  return key.find("..") == std::string::npos;
}

}  // namespace sift
