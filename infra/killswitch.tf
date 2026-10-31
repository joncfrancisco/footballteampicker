data "archive_file" "killswitch" {
  type        = "zip"
  source_file = "${path.module}/../api/dist/kill.mjs"
  output_path = "${path.module}/.build/kill.zip"
}

resource "aws_iam_role" "killswitch" {
  name                 = "footballteampicker-api-killswitch"
  assume_role_policy   = data.aws_iam_policy_document.api_assume.json
  permissions_boundary = "arn:aws:iam::${data.aws_caller_identity.current.account_id}:policy/footballteampicker-boundary"
}

data "aws_iam_policy_document" "killswitch" {
  # Runtime SDK actions were checked with IAM Policy Autopilot. The SNS topic is not
  # KMS-encrypted, so its generated optional KMS permissions are unnecessary here.
  statement {
    actions   = ["lambda:PutFunctionConcurrency"]
    resources = [aws_lambda_function.api.arn]
  }
  statement {
    actions   = ["sns:Publish"]
    resources = [aws_sns_topic.alerts.arn]
  }
  statement {
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["${aws_cloudwatch_log_group.killswitch.arn}:*"]
  }
}

resource "aws_iam_role_policy" "killswitch" {
  name   = "footballteampicker-killswitch"
  role   = aws_iam_role.killswitch.id
  policy = data.aws_iam_policy_document.killswitch.json
}

resource "aws_cloudwatch_log_group" "killswitch" {
  name              = "/aws/lambda/footballteampicker-killswitch"
  retention_in_days = 30
}

resource "aws_lambda_function" "killswitch" {
  function_name                  = "footballteampicker-killswitch"
  role                           = aws_iam_role.killswitch.arn
  runtime                        = "nodejs22.x"
  architectures                  = ["arm64"]
  handler                        = "kill.handler"
  filename                       = data.archive_file.killswitch.output_path
  source_code_hash               = data.archive_file.killswitch.output_base64sha256
  memory_size                    = 128
  timeout                        = 10
  reserved_concurrent_executions = 1
  logging_config {
    log_format = "JSON"
    log_group  = aws_cloudwatch_log_group.killswitch.name
  }
  environment {
    variables = { ALERTS_TOPIC = aws_sns_topic.alerts.arn }
  }
  depends_on = [aws_iam_role_policy.killswitch]
}

resource "aws_lambda_permission" "killswitch_sns" {
  statement_id   = "OwnAlertsTopicOnly"
  action         = "lambda:InvokeFunction"
  function_name  = aws_lambda_function.killswitch.function_name
  principal      = "sns.amazonaws.com"
  source_arn     = aws_sns_topic.alerts.arn
  source_account = data.aws_caller_identity.current.account_id
}

resource "aws_sns_topic_subscription" "killswitch" {
  topic_arn           = aws_sns_topic.alerts.arn
  protocol            = "lambda"
  endpoint            = aws_lambda_function.killswitch.arn
  filter_policy_scope = "MessageBody"
  filter_policy = jsonencode({
    AlarmName     = ["footballteampicker-write-spike", "footballteampicker-dynamodb-write-spike"]
    NewStateValue = ["ALARM"]
  })
  depends_on = [aws_lambda_permission.killswitch_sns]
}

resource "aws_cloudwatch_metric_alarm" "write_spike" {
  alarm_name          = "footballteampicker-write-spike"
  namespace           = "AWS/Lambda"
  metric_name         = "Invocations"
  statistic           = "Sum"
  period              = 3600
  evaluation_periods  = 1
  datapoints_to_alarm = 1
  threshold           = 50000
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  dimensions          = { FunctionName = aws_lambda_function.api.function_name }
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]
}

resource "aws_cloudwatch_metric_alarm" "dynamodb_write_spike" {
  alarm_name          = "footballteampicker-dynamodb-write-spike"
  namespace           = "AWS/DynamoDB"
  metric_name         = "ConsumedWriteCapacityUnits"
  statistic           = "Sum"
  period              = 3600
  evaluation_periods  = 1
  datapoints_to_alarm = 1
  threshold           = 100000
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  dimensions          = { TableName = aws_dynamodb_table.main.name }
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]
}

resource "aws_budgets_budget_action" "deny_api" {
  budget_name        = aws_budgets_budget.monthly.name
  action_type        = "APPLY_IAM_POLICY"
  approval_model     = "AUTOMATIC"
  notification_type  = "ACTUAL"
  execution_role_arn = "arn:aws:iam::${data.aws_caller_identity.current.account_id}:role/footballteampicker-budget-action"
  action_threshold {
    action_threshold_type  = "ABSOLUTE_VALUE"
    action_threshold_value = 10
  }
  definition {
    iam_action_definition {
      policy_arn = "arn:aws:iam::${data.aws_caller_identity.current.account_id}:policy/footballteampicker-api-budget-deny"
      roles      = [aws_iam_role.api.name]
    }
  }
  subscriber {
    address           = var.alert_email
    subscription_type = "EMAIL"
  }
}
