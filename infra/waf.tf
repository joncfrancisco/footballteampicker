# Free plan: all-path rate limit plus three AWS managed groups. The API scope-down rate
# rule is optional because Free subscription rejected the nested statement (#17 fallback).
resource "aws_wafv2_web_acl" "site" {
  name  = "footballteampicker-site"
  scope = "CLOUDFRONT"

  default_action {
    allow {}
  }

  rule {
    name     = "rate-all"
    priority = 10

    action {
      dynamic "block" {
        for_each = var.waf_rate_action == "block" ? [1] : []
        content {}
      }
      dynamic "count" {
        for_each = var.waf_rate_action == "count" ? [1] : []
        content {}
      }
    }

    statement {
      rate_based_statement {
        limit                 = 2000
        evaluation_window_sec = 300
        aggregate_key_type    = "IP"
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "footballteampicker-rate-all"
      sampled_requests_enabled   = true
    }
  }

  dynamic "rule" {
    for_each = var.waf_api_rate_enabled ? [1] : []
    content {
      name     = "rate-api"
      priority = 20

      action {
        dynamic "block" {
          for_each = var.waf_rate_action == "block" ? [1] : []
          content {}
        }
        dynamic "count" {
          for_each = var.waf_rate_action == "count" ? [1] : []
          content {}
        }
      }

      statement {
        rate_based_statement {
          limit                 = 300
          evaluation_window_sec = 300
          aggregate_key_type    = "IP"

          scope_down_statement {
            byte_match_statement {
              search_string         = "/api/"
              positional_constraint = "STARTS_WITH"
              field_to_match {
                uri_path {}
              }
              text_transformation {
                priority = 0
                type     = "NONE"
              }
            }
          }
        }
      }

      visibility_config {
        cloudwatch_metrics_enabled = true
        metric_name                = "footballteampicker-rate-api"
        sampled_requests_enabled   = true
      }
    }
  }

  dynamic "rule" {
    for_each = {
      "aws-ip-reputation"    = { priority = 30, group = "AWSManagedRulesAmazonIpReputationList" }
      "aws-known-bad-inputs" = { priority = 40, group = "AWSManagedRulesKnownBadInputsRuleSet" }
      "aws-common"           = { priority = 50, group = "AWSManagedRulesCommonRuleSet" }
    }
    content {
      name     = rule.key
      priority = rule.value.priority
      override_action {
        none {}
      }
      statement {
        managed_rule_group_statement {
          vendor_name = "AWS"
          name        = rule.value.group
          dynamic "rule_action_override" {
            for_each = rule.value.group == "AWSManagedRulesCommonRuleSet" ? [1] : []
            content {
              name = "SizeRestrictions_BODY"
              action_to_use {
                count {}
              }
            }
          }
        }
      }
      visibility_config {
        cloudwatch_metrics_enabled = true
        metric_name                = "footballteampicker-${rule.key}"
        sampled_requests_enabled   = true
      }
    }
  }

  visibility_config {
    cloudwatch_metrics_enabled = true
    metric_name                = "footballteampicker-site"
    sampled_requests_enabled   = true
  }
}
