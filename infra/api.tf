# The API Lambda behind CloudFront /api/*: writes only. It stores to DynamoDB and publishes
# JSON to the media bucket, which every read comes from (#9).

data "archive_file" "api" {
  type        = "zip"
  source_file = "${path.module}/../api/dist/index.mjs"
  output_path = "${path.module}/.build/api.zip"
}

data "aws_iam_policy_document" "api_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

# The deploy role can only create roles under this boundary (bootstrap/boundary.json).
resource "aws_iam_role" "api" {
  name                 = "footballteampicker-api"
  assume_role_policy   = data.aws_iam_policy_document.api_assume.json
  permissions_boundary = "arn:aws:iam::${data.aws_caller_identity.current.account_id}:policy/footballteampicker-boundary"
}

data "aws_iam_policy_document" "api" {
  statement {
    sid       = "Logs"
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["${aws_cloudwatch_log_group.api.arn}:*"]
  }

  statement {
    sid = "Table"
    actions = [
      "dynamodb:GetItem",
      "dynamodb:PutItem",
      "dynamodb:UpdateItem",
      "dynamodb:DeleteItem",
      "dynamodb:Query",
    ]
    resources = [aws_dynamodb_table.main.arn, "${aws_dynamodb_table.main.arn}/index/*"]
  }

  statement {
    sid       = "PublishMedia"
    actions   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
    resources = ["${aws_s3_bucket.media.arn}/m/*", "${aws_s3_bucket.media.arn}/tmp/*"]
  }

  # Turnstile secret and IP salt are SecureStrings set out of band, never in Terraform state.
  statement {
    sid       = "Secrets"
    actions   = ["ssm:GetParameter"]
    resources = ["arn:aws:ssm:us-east-1:${data.aws_caller_identity.current.account_id}:parameter/footballteampicker/*"]
  }

  statement {
    sid       = "DecryptSecrets"
    actions   = ["kms:Decrypt"]
    resources = ["*"]
    condition {
      test     = "StringEquals"
      variable = "kms:ViaService"
      values   = ["ssm.us-east-1.amazonaws.com"]
    }
  }
}

resource "aws_iam_role_policy" "api" {
  name   = "footballteampicker-api"
  role   = aws_iam_role.api.id
  policy = data.aws_iam_policy_document.api.json
}

resource "aws_cloudwatch_log_group" "api" {
  name              = "/aws/lambda/footballteampicker-api"
  retention_in_days = 30
}

resource "aws_lambda_function" "api" {
  function_name    = "footballteampicker-api"
  role             = aws_iam_role.api.arn
  runtime          = "nodejs22.x"
  architectures    = ["arm64"]
  handler          = "index.handler"
  filename         = data.archive_file.api.output_path
  source_code_hash = data.archive_file.api.output_base64sha256
  memory_size      = 256
  timeout          = 10
  # Hard cap (#17, #18). The kill switch drops this to 0.
  reserved_concurrent_executions = 25

  logging_config {
    log_format = "JSON"
    log_group  = aws_cloudwatch_log_group.api.name
  }

  environment {
    variables = {
      TABLE                  = aws_dynamodb_table.main.name
      MEDIA_BUCKET           = aws_s3_bucket.media.bucket
      TURNSTILE_SECRET_PARAM = "/footballteampicker/turnstile-secret"
      SITE_HOSTNAME          = var.domain
    }
  }

  depends_on = [aws_iam_role_policy.api]
}

resource "aws_lambda_function_url" "api" {
  function_name      = aws_lambda_function.api.function_name
  authorization_type = "AWS_IAM"
}

# CloudFront signs origin requests with OAC; only this distribution may invoke the URL.
# Function URLs need both permissions.
resource "aws_lambda_permission" "cloudfront_url" {
  statement_id  = "AllowCloudFrontInvokeFunctionUrl"
  action        = "lambda:InvokeFunctionUrl"
  function_name = aws_lambda_function.api.function_name
  principal     = "cloudfront.amazonaws.com"
  source_arn    = aws_cloudfront_distribution.site.arn
}

resource "aws_lambda_permission" "cloudfront_invoke" {
  statement_id  = "AllowCloudFrontInvokeFunction"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.api.function_name
  principal     = "cloudfront.amazonaws.com"
  source_arn    = aws_cloudfront_distribution.site.arn
}

resource "aws_cloudfront_origin_access_control" "api" {
  name                              = "footballteampicker-api"
  description                       = "CloudFront to the API function URL"
  origin_access_control_origin_type = "lambda"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}
