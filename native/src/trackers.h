// Tracker blocking against a bundled domain list (app/data/trackers.txt).
// This is a plain host match, not a full filter-list engine: it blocks
// requests whose host is, or is a subdomain of, a listed domain, unless the
// page itself belongs to that domain.
#ifndef SIFT_TRACKERS_H_
#define SIFT_TRACKERS_H_

#include <atomic>
#include <string>
#include <unordered_set>

namespace sift {

class TrackerList {
 public:
  static TrackerList& Get();
  void Load(const std::string& path);
  // Returns the listed domain that matched, or empty.
  std::string Match(const std::string& request_host, const std::string& page_host) const;
  size_t size() const { return domains_.size(); }
  void set_enabled(bool enabled) { enabled_ = enabled; }
  bool enabled() const { return enabled_; }

 private:
  std::unordered_set<std::string> domains_;
  std::atomic<bool> enabled_{true};
};

}  // namespace sift

#endif  // SIFT_TRACKERS_H_
