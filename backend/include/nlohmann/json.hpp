/// Minimal nlohmann::json shim for offline compilation.
/// Supports: object construction, array, dump(), operator[], initializer_list.
/// Replace with the real nlohmann/json.hpp in production.
#pragma once

#include <map>
#include <string>
#include <variant>
#include <vector>
#include <sstream>
#include <initializer_list>
#include <cstdint>
#include <stdexcept>

namespace nlohmann {

class json {
public:
    enum class value_t { null_v, object_v, array_v, string_v, number_int_v, number_uint_v, number_float_v, boolean_v };

    using object_t = std::map<std::string, json>;
    using array_t  = std::vector<json>;

private:
    value_t type_ = value_t::null_v;
    object_t obj_;
    array_t  arr_;
    std::string str_;
    double num_ = 0.0;
    bool bool_ = false;

public:
    json() = default;

    json(std::nullptr_t) : type_(value_t::null_v) {}
    json(bool v) : type_(value_t::boolean_v), bool_(v) {}
    json(int v) : type_(value_t::number_int_v), num_(v) {}
    json(int64_t v) : type_(value_t::number_int_v), num_(static_cast<double>(v)) {}
    json(uint64_t v) : type_(value_t::number_uint_v), num_(static_cast<double>(v)) {}
    json(double v) : type_(value_t::number_float_v), num_(v) {}
    json(const char* v) : type_(value_t::string_v), str_(v) {}
    json(const std::string& v) : type_(value_t::string_v), str_(v) {}
    json(std::string&& v) : type_(value_t::string_v), str_(std::move(v)) {}

    // Initializer list constructor for objects: { {"key", value}, ... }
    json(std::initializer_list<json> init) {
        bool is_obj = true;
        for (auto& el : init) {
            if (el.type_ != value_t::array_v || el.arr_.size() != 2 ||
                el.arr_[0].type_ != value_t::string_v) {
                is_obj = false;
                break;
            }
        }
        if (is_obj && init.size() > 0) {
            type_ = value_t::object_v;
            for (auto& el : init) {
                obj_[el.arr_[0].str_] = el.arr_[1];
            }
        } else {
            type_ = value_t::array_v;
            for (auto& el : init) {
                arr_.push_back(el);
            }
        }
    }

    // Key-value pair (for initializer-list object construction)
    json(const std::string& key, const json& val) {
        type_ = value_t::array_v;
        arr_.push_back(json(key));
        arr_.push_back(val);
    }

    static json object(std::initializer_list<json> init = {}) {
        json j;
        j.type_ = value_t::object_v;
        for (auto& el : init) {
            if (el.type_ == value_t::array_v && el.arr_.size() == 2 &&
                el.arr_[0].type_ == value_t::string_v) {
                j.obj_[el.arr_[0].str_] = el.arr_[1];
            }
        }
        return j;
    }

    static json array(std::initializer_list<json> init = {}) {
        json j;
        j.type_ = value_t::array_v;
        j.arr_ = array_t(init);
        return j;
    }

    json& operator[](const std::string& key) {
        if (type_ == value_t::null_v) type_ = value_t::object_v;
        return obj_[key];
    }

    json& operator[](size_t idx) {
        if (type_ == value_t::null_v) { type_ = value_t::array_v; }
        if (idx >= arr_.size()) arr_.resize(idx + 1);
        return arr_[idx];
    }

    void push_back(const json& val) {
        if (type_ == value_t::null_v) type_ = value_t::array_v;
        arr_.push_back(val);
    }

    std::string dump(int indent = -1) const {
        std::ostringstream os;
        dump_impl(os, indent, 0);
        return os.str();
    }

private:
    void dump_impl(std::ostringstream& os, int indent, int depth) const {
        std::string pad = (indent >= 0) ? std::string(depth * indent, ' ') : "";
        std::string pad1 = (indent >= 0) ? std::string((depth + 1) * indent, ' ') : "";
        std::string nl = (indent >= 0) ? "\n" : "";
        std::string sep = (indent >= 0) ? ": " : ":";

        switch (type_) {
        case value_t::null_v:
            os << "null"; break;
        case value_t::boolean_v:
            os << (bool_ ? "true" : "false"); break;
        case value_t::number_int_v:
            os << static_cast<int64_t>(num_); break;
        case value_t::number_uint_v:
            os << static_cast<uint64_t>(num_); break;
        case value_t::number_float_v: {
            // fixed 6 decimals
            char buf[64];
            snprintf(buf, sizeof(buf), "%.6f", num_);
            os << buf;
            break;
        }
        case value_t::string_v:
            os << '"' << escape(str_) << '"'; break;
        case value_t::array_v: {
            os << '[' << nl;
            for (size_t i = 0; i < arr_.size(); ++i) {
                os << pad1;
                arr_[i].dump_impl(os, indent, depth + 1);
                if (i + 1 < arr_.size()) os << ',';
                os << nl;
            }
            os << pad << ']';
            break;
        }
        case value_t::object_v: {
            os << '{' << nl;
            size_t i = 0;
            for (auto& [k, v] : obj_) {
                os << pad1 << '"' << escape(k) << '"' << sep;
                v.dump_impl(os, indent, depth + 1);
                if (++i < obj_.size()) os << ',';
                os << nl;
            }
            os << pad << '}';
            break;
        }
        }
    }

    static std::string escape(const std::string& s) {
        std::string out;
        out.reserve(s.size());
        for (char c : s) {
            switch (c) {
                case '"':  out += "\\\""; break;
                case '\\': out += "\\\\"; break;
                case '\n': out += "\\n";  break;
                case '\r': out += "\\r";  break;
                case '\t': out += "\\t";  break;
                default:   out += c;
            }
        }
        return out;
    }
};

} // namespace nlohmann
