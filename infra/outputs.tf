output "site_bucket" {
  description = "S3 bucket the deploy workflow syncs web/dist into."
  value       = aws_s3_bucket.site.bucket
}

output "media_bucket" {
  description = "Private media bucket, including immutable seed atlases."
  value       = aws_s3_bucket.media.bucket
}

output "distribution_id" {
  description = "CloudFront distribution to invalidate after a deploy."
  value       = aws_cloudfront_distribution.site.id
}

output "site_url" {
  value = "https://${var.domain}/"
}
