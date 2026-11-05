#!/bin/sh
# Website enquiry backend: POST https://www.launchboxpk.com/api/enquiry
#   CloudFront /api/* (existing behaviour) -> API Gateway l7690f2dzg -> Lambda launchbox-enquiry
#   -> SES email to contact@launchboxpk.com + DynamoDB table launchbox-enquiries (the lead list)
# Idempotent: safe to re-run. Needs AWS credentials for account 304359596288 (us-east-1).
set -e
export AWS_REGION=us-east-1 AWS_PAGER=""
ACCOUNT=304359596288; API=l7690f2dzg; FN=launchbox-enquiry; ROLE=$FN-role; TABLE=launchbox-enquiries; DOMAIN=launchboxpk.com
HERE="$(cd "$(dirname "$0")" && pwd)"
[ "$(aws sts get-caller-identity --query Account --output text)" = "$ACCOUNT" ] || { echo "Wrong AWS account"; exit 1; }

echo "== 1. SES domain identity ($DOMAIN)"
aws sesv2 get-email-identity --email-identity $DOMAIN >/dev/null 2>&1 || aws sesv2 create-email-identity --email-identity $DOMAIN >/dev/null
aws sesv2 get-email-identity --email-identity $DOMAIN --query 'DkimAttributes.{status:Status,tokens:Tokens}' --output json

echo "== 2. DynamoDB table $TABLE"
if ! aws dynamodb describe-table --table-name $TABLE >/dev/null 2>&1; then
  aws dynamodb create-table --table-name $TABLE --billing-mode PAY_PER_REQUEST \
    --attribute-definitions AttributeName=id,AttributeType=S --key-schema AttributeName=id,KeyType=HASH >/dev/null
  aws dynamodb wait table-exists --table-name $TABLE
  aws dynamodb update-continuous-backups --table-name $TABLE --point-in-time-recovery-specification PointInTimeRecoveryEnabled=true >/dev/null
fi

echo "== 3. IAM role $ROLE"
if ! aws iam get-role --role-name $ROLE >/dev/null 2>&1; then
  aws iam create-role --role-name $ROLE --assume-role-policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"lambda.amazonaws.com"},"Action":"sts:AssumeRole"}]}' >/dev/null
  aws iam attach-role-policy --role-name $ROLE --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole
  sleep 10
fi
aws iam put-role-policy --role-name $ROLE --policy-name enquiry --policy-document "{\"Version\":\"2012-10-17\",\"Statement\":[
 {\"Effect\":\"Allow\",\"Action\":\"ses:SendEmail\",\"Resource\":\"arn:aws:ses:us-east-1:$ACCOUNT:identity/$DOMAIN\"},
 {\"Effect\":\"Allow\",\"Action\":\"dynamodb:PutItem\",\"Resource\":\"arn:aws:dynamodb:us-east-1:$ACCOUNT:table/$TABLE\"}]}"

echo "== 4. Lambda $FN"
TMP=$(mktemp -d); (cd "$HERE/lambda" && zip -q "$TMP/fn.zip" index.mjs)
ENV='Variables={TO_EMAIL=contact@launchboxpk.com,FROM_EMAIL=Launchbox Website <website@launchboxpk.com>,TABLE='$TABLE'}'
if aws lambda get-function --function-name $FN >/dev/null 2>&1; then
  aws lambda update-function-code --function-name $FN --zip-file fileb://$TMP/fn.zip >/dev/null
  aws lambda wait function-updated --function-name $FN
  aws lambda update-function-configuration --function-name $FN --environment "$ENV" >/dev/null
else
  aws lambda create-function --function-name $FN --runtime nodejs20.x --handler index.handler --memory-size 256 --timeout 10 \
    --role arn:aws:iam::$ACCOUNT:role/$ROLE --zip-file fileb://$TMP/fn.zip --environment "$ENV" >/dev/null
  aws lambda wait function-active --function-name $FN
fi
LARN=arn:aws:lambda:us-east-1:$ACCOUNT:function:$FN

echo "== 5. API Gateway route POST /api/enquiry"
INT=$(aws apigatewayv2 get-integrations --api-id $API --query "Items[?IntegrationUri=='$LARN'].IntegrationId | [0]" --output text)
[ "$INT" != "None" ] || INT=$(aws apigatewayv2 create-integration --api-id $API --integration-type AWS_PROXY --integration-uri $LARN \
  --payload-format-version 2.0 --timeout-in-millis 10000 --query IntegrationId --output text)
RID=$(aws apigatewayv2 get-routes --api-id $API --query "Items[?RouteKey=='POST /api/enquiry'].RouteId | [0]" --output text)
[ "$RID" != "None" ] || aws apigatewayv2 create-route --api-id $API --route-key 'POST /api/enquiry' --target integrations/$INT >/dev/null
aws lambda add-permission --function-name $FN --statement-id apigw-enquiry --action lambda:InvokeFunction --principal apigateway.amazonaws.com \
  --source-arn "arn:aws:execute-api:us-east-1:$ACCOUNT:$API/*/POST/api/enquiry" >/dev/null 2>&1 || true
STAGE=$(aws apigatewayv2 get-stages --api-id $API --query 'Items[0].StageName' --output text)
aws apigatewayv2 update-stage --api-id $API --stage-name "$STAGE" \
  --route-settings '{"POST /api/enquiry":{"ThrottlingBurstLimit":10,"ThrottlingRateLimit":2}}' >/dev/null
AUTO=$(aws apigatewayv2 get-stage --api-id $API --stage-name "$STAGE" --query AutoDeploy --output text)
[ "$AUTO" = "True" ] || aws apigatewayv2 create-deployment --api-id $API --stage-name "$STAGE" >/dev/null
echo "stage=$STAGE autodeploy=$AUTO"

echo "== done. Test: curl -s -X POST https://www.launchboxpk.com/api/enquiry -H 'content-type: application/json' -d '{\"name\":\"Test\",\"phone\":\"03001234567\",\"plan\":\"Day Pass\",\"message\":\"deploy test\"}'"
