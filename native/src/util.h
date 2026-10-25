// Small helpers shared by the Sift host: paths, files, JSON values.
#ifndef SIFT_UTIL_H_
#define SIFT_UTIL_H_

#include <string>
#include <vector>

#include "include/cef_values.h"

namespace sift {

// Directory that holds the bundled UI (app/) and data files.
std::string ResourceDir();
// Root of all user data: CEF cache, profiles and Sift's own state.
std::string UserDataRoot();
std::string ProfileDir(const std::string& profile_id);
std::string DownloadsDir();
std::string HomeDir();

bool ReadFile(const std::string& path, std::string* out);
// Writes via a temporary file and rename so a crash never leaves half a file.
bool WriteFileAtomic(const std::string& path, const std::string& data);
bool FileExists(const std::string& path);
bool MakeDirs(const std::string& path);
std::string JoinPath(const std::string& a, const std::string& b);
std::string UniquePath(const std::string& dir, const std::string& name);

// Opens a file or folder with the platform's default handler.
void OpenWithSystem(const std::string& path, bool reveal);

std::string ToJson(CefRefPtr<CefValue> value);
CefRefPtr<CefDictionaryValue> NewDict();
std::string HostOf(const std::string& url);
bool IsSafeKey(const std::string& key);

}  // namespace sift

#endif  // SIFT_UTIL_H_
