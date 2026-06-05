###############################################################################
# Outputs
###############################################################################

output "api_invoke_url" {
  description = "Base invoke URL of the HTTP API. The POST endpoint is <this>/api/generate."
  value       = aws_apigatewayv2_api.http.api_endpoint
}

output "api_generate_endpoint" {
  description = "Full POST endpoint the CloudFront /api/* behavior should forward to."
  value       = "${aws_apigatewayv2_api.http.api_endpoint}/api/generate"
}

output "api_gateway_domain" {
  description = "Hostname only (no scheme/path). Use this as the CloudFront custom origin domain for the /api/* behavior."
  value       = replace(aws_apigatewayv2_api.http.api_endpoint, "https://", "")
}

output "lambda_function_name" {
  description = "Name of the Lambda function (for logs / CLI invoke)."
  value       = aws_lambda_function.generate.function_name
}
