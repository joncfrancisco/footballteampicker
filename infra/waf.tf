# Starts with the two rate-based rules; #17 adds the managed rule groups (5 rules max on the
# Free plan). Limits are per IP per 5 minutes, loose enough for a classroom behind one NAT.
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

  rule {
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

  visibility_config {
    cloudwatch_metrics_enabled = true
    metric_name                = "footballteampicker-site"
    sampled_requests_enabled   = true
  }
}
