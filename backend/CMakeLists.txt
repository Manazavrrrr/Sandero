cmake_minimum_required(VERSION 3.16)
project(smart_meter_solana
    VERSION   0.1.0
    LANGUAGES CXX
)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)

# ── Dependencies ─────────────────────────────────────────────────────────

# nlohmann/json — header-only.
# Try system-installed first; fall back to FetchContent.
find_package(nlohmann_json 3.11 QUIET)
if(NOT nlohmann_json_FOUND)
    include(FetchContent)
    FetchContent_Declare(json
        GIT_REPOSITORY https://github.com/nlohmann/json.git
        GIT_TAG        v3.11.3
    )
    FetchContent_MakeAvailable(json)
endif()

# Optional: libcurl for raw JSON-RPC path.
find_package(CURL QUIET)

# ── Executable ───────────────────────────────────────────────────────────

add_executable(smart_meter
    src/main.cpp
    src/smart_meter.cpp
)

target_include_directories(smart_meter PRIVATE include)
target_link_libraries(smart_meter PRIVATE nlohmann_json::nlohmann_json)

if(CURL_FOUND)
    target_compile_definitions(smart_meter PRIVATE HAS_LIBCURL)
    target_link_libraries(smart_meter PRIVATE CURL::libcurl)
    message(STATUS "libcurl found — JSON-RPC transport enabled")
else()
    message(STATUS "libcurl not found — JSON-RPC will dry-run (CLI bridge still works)")
endif()

target_compile_options(smart_meter PRIVATE
    -Wall -Wextra -Wpedantic
)
