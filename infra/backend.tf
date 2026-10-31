terraform {
  backend "s3" {
    bucket       = "tfstate-020949219706"
    key          = "footballteampicker/infra.tfstate"
    region       = "us-east-1"
    encrypt      = true
    use_lockfile = true
  }
}
