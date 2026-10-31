provider "aws" {
  region              = "us-east-1"
  allowed_account_ids = ["020949219706"]

  default_tags {
    tags = {
      app        = "footballteampicker"
      managed-by = "terraform"
    }
  }
}
