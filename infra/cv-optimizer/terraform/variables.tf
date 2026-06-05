###############################################################################
# Input variables
#
# anthropic_api_key is SENSITIVE. Never put it in a committed .tfvars file.
# Pass it at apply time via an environment variable:
#
#   export TF_VAR_anthropic_api_key="sk-ant-..."
#   terraform apply
#
# Terraform automatically reads TF_VAR_<name> from the environment.
###############################################################################

variable "aws_region" {
  description = "AWS region for the Lambda + API Gateway. Keep this close to the prod stack."
  type        = string
  default     = "us-east-1"
}

variable "anthropic_api_key" {
  description = "Anthropic API key, injected into the Lambda environment. Provide via TF_VAR_anthropic_api_key — do NOT hardcode or commit."
  type        = string
  sensitive   = true
}
