# Sift native host (CEF).
#
#   cmake -B build -DCEF_ROOT=/path/to/cef_binary_<version>_<platform>
#   cmake --build build --config Release
#
# scripts/fetch-cef.sh downloads a matching CEF binary distribution into
# third_party/cef and is what CI and the docs use.
cmake_minimum_required(VERSION 3.21)
project(sift LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set_property(GLOBAL PROPERTY USE_FOLDERS ON)

if(NOT DEFINED CMAKE_BUILD_TYPE OR CMAKE_BUILD_TYPE STREQUAL "")
  set(CMAKE_BUILD_TYPE Release)
endif()
if(NOT CEF_ROOT)
  set(CEF_ROOT "${CMAKE_CURRENT_SOURCE_DIR}/../third_party/cef")
endif()
if(NOT EXISTS "${CEF_ROOT}/cmake/FindCEF.cmake")
  message(FATAL_ERROR "CEF not found at ${CEF_ROOT}. Run scripts/fetch-cef.sh or pass -DCEF_ROOT=...")
endif()
list(APPEND CMAKE_MODULE_PATH "${CEF_ROOT}/cmake")
find_package(CEF REQUIRED)
add_subdirectory(${CEF_LIBCEF_DLL_WRAPPER_PATH} libcef_dll_wrapper)

set(SIFT_APP_DIR "${CMAKE_CURRENT_SOURCE_DIR}/../app")

set(SIFT_COMMON_SRCS
  src/app.cc src/app.h
  src/clients.cc src/clients.h
  src/scheme.cc src/scheme.h
  src/trackers.cc src/trackers.h
  src/util.cc src/util.h
  src/window.cc src/window.h
)

if(OS_MAC)
  list(APPEND SIFT_COMMON_SRCS src/window_mac.mm)
endif()

SET_CEF_TARGET_OUT_DIR()

if(OS_LINUX)
  ADD_LOGICAL_TARGET("libcef_lib" "${CEF_LIB_DEBUG}" "${CEF_LIB_RELEASE}")
  add_executable(sift ${SIFT_COMMON_SRCS} src/main_linux.cc)
  SET_EXECUTABLE_TARGET_PROPERTIES(sift)
  add_dependencies(sift libcef_dll_wrapper)
  target_link_libraries(sift libcef_lib libcef_dll_wrapper ${CEF_STANDARD_LIBS} X11)
  set_property(TARGET sift PROPERTY BUILD_RPATH "$ORIGIN")
  COPY_FILES(sift "${CEF_BINARY_FILES}" "${CEF_BINARY_DIR}" "${CEF_TARGET_OUT_DIR}")
  COPY_FILES(sift "${CEF_RESOURCE_FILES}" "${CEF_RESOURCE_DIR}" "${CEF_TARGET_OUT_DIR}")
  add_custom_command(TARGET sift POST_BUILD
    COMMAND ${CMAKE_COMMAND} -E copy_directory "${SIFT_APP_DIR}" "${CEF_TARGET_OUT_DIR}/app"
    COMMENT "Copying Sift UI")
  if(EXISTS "${CEF_BINARY_DIR}/chrome-sandbox")
    SET_LINUX_SUID_PERMISSIONS(sift "${CEF_TARGET_OUT_DIR}/chrome-sandbox")
  endif()
endif()

if(OS_WINDOWS)
  ADD_LOGICAL_TARGET("libcef_lib" "${CEF_LIB_DEBUG}" "${CEF_LIB_RELEASE}")
  add_executable(sift WIN32 ${SIFT_COMMON_SRCS} src/main_win.cc)
  SET_EXECUTABLE_TARGET_PROPERTIES(sift)
  add_dependencies(sift libcef_dll_wrapper)
  target_link_libraries(sift libcef_lib libcef_dll_wrapper ${CEF_STANDARD_LIBS} shell32)
  COPY_FILES(sift "${CEF_BINARY_FILES}" "${CEF_BINARY_DIR}" "${CEF_TARGET_OUT_DIR}")
  COPY_FILES(sift "${CEF_RESOURCE_FILES}" "${CEF_RESOURCE_DIR}" "${CEF_TARGET_OUT_DIR}")
  add_custom_command(TARGET sift POST_BUILD
    COMMAND ${CMAKE_COMMAND} -E copy_directory "${SIFT_APP_DIR}" "${CEF_TARGET_OUT_DIR}/app"
    COMMENT "Copying Sift UI")
endif()

if(OS_MAC)
  # Sift.app plus the helper apps CEF requires on macOS, laid out like CEF's
  # cefsimple sample. Build with the Xcode generator:
  #   cmake -G Xcode -S native -B build -DPROJECT_ARCH=arm64
  set(SIFT_HELPER_TARGET "sift_helper")
  set(SIFT_HELPER_OUTPUT_NAME "Sift Helper")
  set(SIFT_APP "${CEF_TARGET_OUT_DIR}/Sift.app")

  # Info.plist placeholders are filled here, not by Xcode.
  set(_main_plist "${CMAKE_CURRENT_BINARY_DIR}/Info.plist")
  file(READ "${CMAKE_CURRENT_SOURCE_DIR}/mac/Info.plist.in" _plist_contents)
  string(REPLACE "\${EXECUTABLE_NAME}" "Sift" _plist_contents "${_plist_contents}")
  file(WRITE "${_main_plist}" "${_plist_contents}")

  add_executable(sift MACOSX_BUNDLE ${SIFT_COMMON_SRCS} src/main_mac.mm mac/Sift.icns)
  SET_EXECUTABLE_TARGET_PROPERTIES(sift)
  add_dependencies(sift libcef_dll_wrapper)
  target_link_libraries(sift libcef_dll_wrapper ${CEF_STANDARD_LIBS} "-framework Cocoa")
  set_source_files_properties(mac/Sift.icns PROPERTIES MACOSX_PACKAGE_LOCATION Resources)
  set_target_properties(sift PROPERTIES
    OUTPUT_NAME "Sift"
    MACOSX_BUNDLE_INFO_PLIST "${_main_plist}"
    XCODE_ATTRIBUTE_PRODUCT_BUNDLE_IDENTIFIER "app.sift.browser")

  COPY_MAC_FRAMEWORK(sift "${CEF_BINARY_DIR}" "${SIFT_APP}")
  add_custom_command(TARGET sift POST_BUILD
    COMMAND ${CMAKE_COMMAND} -E copy_directory "${SIFT_APP_DIR}" "${SIFT_APP}/Contents/Resources/app"
    VERBATIM)

  foreach(_suffix_list ${CEF_HELPER_APP_SUFFIXES})
    string(REPLACE ":" ";" _suffix_list ${_suffix_list})
    list(GET _suffix_list 0 _name_suffix)
    list(GET _suffix_list 1 _target_suffix)
    list(GET _suffix_list 2 _plist_suffix)
    set(_helper_target "${SIFT_HELPER_TARGET}${_target_suffix}")
    set(_helper_output_name "${SIFT_HELPER_OUTPUT_NAME}${_name_suffix}")
    set(_helper_info_plist "${CMAKE_CURRENT_BINARY_DIR}/helper-Info${_target_suffix}.plist")
    file(READ "${CMAKE_CURRENT_SOURCE_DIR}/mac/helper-Info.plist.in" _plist_contents)
    string(REPLACE "\${EXECUTABLE_NAME}" "${_helper_output_name}" _plist_contents "${_plist_contents}")
    string(REPLACE "\${PRODUCT_NAME}" "${_helper_output_name}" _plist_contents "${_plist_contents}")
    string(REPLACE "\${BUNDLE_ID_SUFFIX}" "${_plist_suffix}" _plist_contents "${_plist_contents}")
    file(WRITE "${_helper_info_plist}" "${_plist_contents}")

    add_executable(${_helper_target} MACOSX_BUNDLE ${SIFT_COMMON_SRCS} src/process_helper_mac.cc)
    SET_EXECUTABLE_TARGET_PROPERTIES(${_helper_target})
    add_dependencies(${_helper_target} libcef_dll_wrapper)
    target_link_libraries(${_helper_target} libcef_dll_wrapper ${CEF_STANDARD_LIBS})
    set_target_properties(${_helper_target} PROPERTIES
      MACOSX_BUNDLE_INFO_PLIST "${_helper_info_plist}"
      OUTPUT_NAME "${_helper_output_name}")
    add_dependencies(sift "${_helper_target}")
    add_custom_command(TARGET sift POST_BUILD
      COMMAND ${CMAKE_COMMAND} -E copy_directory
              "${CEF_TARGET_OUT_DIR}/${_helper_output_name}.app"
              "${SIFT_APP}/Contents/Frameworks/${_helper_output_name}.app"
      VERBATIM)
  endforeach()
endif()

PRINT_CEF_CONFIG()
