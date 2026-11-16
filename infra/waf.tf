locals {
  # A load-test window counts rate-rule matches instead of blocking them (#18).
  waf_rate_action = var.loadtest_mode ? "count" : var.waf_rate_action
}

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
        for_each = local.waf_rate_action == "block" ? [1] : []
        content {}
      }
      dynamic "count" {
        for_each = local.waf_rate_action == "count" ? [1] : []
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
          for_each = local.waf_rate_action == "block" ? [1] : []
          content {}
        }
        dynamic "count" {
          for_each = local.waf_rate_action == "count" ? [1] : []
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

# Per-request WAF logs (who was blocked or allowed, and why). The name must start with
# aws-waf-logs-. A few thousand requests a week is well under a megabyte a day.
resource "aws_cloudwatch_log_group" "waf" {
  name              = "aws-waf-logs-footballteampicker"
  retention_in_days = 30
}

# WAF delivers through the log delivery service, which needs this account-level policy.
# Owning it here stops WAF from writing its own catch-all AWSWAF-LOGS policy.
data "aws_iam_policy_document" "waf_logs" {
  statement {
    principals {
      type        = "Service"
      identifiers = ["delivery.logs.amazonaws.com"]
    }
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["${aws_cloudwatch_log_group.waf.arn}:*"]
    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [data.aws_caller_identity.current.account_id]
    }
    condition {
      test     = "ArnLike"
      variable = "aws:SourceArn"
      values   = ["arn:aws:logs:us-east-1:${data.aws_caller_identity.current.account_id}:*"]
    }
  }
}

resource "aws_cloudwatch_log_resource_policy" "waf" {
  policy_name     = "footballteampicker-waf-logs"
  policy_document = data.aws_iam_policy_document.waf_logs.json
}

resource "aws_wafv2_web_acl_logging_configuration" "site" {
  resource_arn            = aws_wafv2_web_acl.site.arn
  log_destination_configs = [aws_cloudwatch_log_group.waf.arn]

  depends_on = [aws_cloudwatch_log_resource_policy.waf]
}
