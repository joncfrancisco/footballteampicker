variable "domain" {
  description = "Public hostname of the site."
  type        = string
  default     = "depthchart.joncfrancis.co"
}

variable "zone_name" {
  description = "Route 53 zone the hostname lives in. Read as data; this stack never owns it."
  type        = string
  default     = "joncfrancis.co"
}

variable "waf_rate_action" {
  description = "Action for the WAF rate-based rules: block in production, count during load tests (#18)."
  type        = string
  default     = "block"

  validation {
    condition     = contains(["block", "count"], var.waf_rate_action)
    error_message = "waf_rate_action must be \"block\" or \"count\"."
  }
}

variable "waf_api_rate_enabled" {
  description = "Optional API scope-down rate rule; disabled for the flat-rate Free plan (#17 fallback)."
  type        = bool
  default     = false
}

variable "loadtest_mode" {
  description = "Load-test window (#18): WAF rate rules count instead of block, and the API accepts the X-Loadtest-Token secret. Only a manual deploy can turn it on; every push to main turns it off."
  type        = bool
  default     = false
}
