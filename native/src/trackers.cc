#include "trackers.h"

#include <sstream>

#include "util.h"

namespace sift {

TrackerList& TrackerList::Get() {
  static TrackerList list;
  return list;
}

void TrackerList::Load(const std::string& path) {
  std::string data;
  if (!ReadFile(path, &data)) return;
  std::istringstream in(data);
  std::string line;
  while (std::getline(in, line)) {
    while (!line.empty() && (line.back() == '\r' || line.back() == ' ')) line.pop_back();
    if (line.empty() || line[0] == '#') continue;
    domains_.insert(line);
  }
}

static bool SameSite(const std::string& host, const std::string& domain) {
  return host == domain ||
         (host.size() > domain.size() && host.compare(host.size() - domain.size(), domain.size(), domain) == 0 &&
          host[host.size() - domain.size() - 1] == '.');
}

std::string TrackerList::Match(const std::string& request_host, const std::string& page_host) const {
  if (!enabled_ || request_host.empty()) return "";
  // Walk up the labels: a.b.tracker.com -> b.tracker.com -> tracker.com.
  std::string host = request_host;
  while (true) {
    if (domains_.count(host)) {
      return SameSite(page_host, host) ? "" : host;
    }
    const size_t dot = host.find('.');
    if (dot == std::string::npos) return "";
    host = host.substr(dot + 1);
    if (host.find('.') == std::string::npos) return "";
  }
}

}  // namespace sift
