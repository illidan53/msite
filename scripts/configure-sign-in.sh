#!/usr/bin/env bash
# Installs Google (Gmail) and Microsoft (Outlook) sign-in credentials on the
# finance instance. See README → "Setting up the providers".
#
# Run it from your own machine after registering the apps:
#   scripts/configure-sign-in.sh
#
# Secrets are read with hidden prompts and stored as SSM SecureString
# parameters under /msite/finance/. They are written to the parameter store
# from a 0600 temp file (never on a command line), and the instance fetches
# them itself, so they never appear in shell history, `ps`, or SSM command
# logs. The instance then updates /etc/msite/msite.env (keeping a backup) and
# restarts msite.service. Leave a client id blank to skip that provider.
#
# Environment: AWS_PROFILE (default nphunter-sso), DRY_RUN=1 to print the
# AWS calls without making them.
set -euo pipefail

PROFILE="${AWS_PROFILE:-nphunter-sso}"
REGION="us-east-1"
PREFIX="/msite/finance"
SITE="https://finance.nphunter.net"
DRY_RUN="${DRY_RUN:-0}"

aws_cli() {
  if [ "$DRY_RUN" = "1" ]; then
    echo "[dry run] aws $*" | sed -E 's/(file:\/\/)[^ ]+/\1<temp file>/' >&2
    return 0
  fi
  aws --profile "$PROFILE" --region "$REGION" "$@"
}

tmpdir="$(mktemp -d)"
chmod 700 "$tmpdir"
trap 'rm -rf "$tmpdir"' EXIT

# Docker --env-file takes values literally: no quotes, spaces or line breaks.
valid() { [[ -n "$1" && "$1" != *[[:space:]\"\']* ]]; }

put_secure() {
  local name="$1" value="$2" file="$tmpdir/value"
  ( umask 077 && printf '%s' "$value" > "$file" )
  aws_cli ssm put-parameter --name "$PREFIX/$name" --type SecureString \
    --overwrite --value "file://$file" >/dev/null
  rm -f "$file"
  echo "  stored $PREFIX/$name"
}

if [ "$DRY_RUN" != "1" ]; then
  aws_cli sts get-caller-identity >/dev/null 2>&1 || {
    echo "AWS session for profile $PROFILE has expired. Run: aws sso login --profile $PROFILE" >&2
    exit 1
  }
fi

configured=()
for provider in google microsoft; do
  label=$([ "$provider" = google ] && echo "Google (Gmail)" || echo "Microsoft (Outlook)")
  read -r -p "$label client id (blank to skip): " client_id
  [ -z "$client_id" ] && { echo "  skipped $label"; continue; }
  read -r -s -p "$label client secret (hidden): " client_secret
  echo
  if ! valid "$client_id" || ! valid "$client_secret"; then
    echo "  $label: values must be non-empty, without spaces or quotes" >&2
    exit 1
  fi
  put_secure "$provider-client-id" "$client_id"
  put_secure "$provider-client-secret" "$client_secret"
  unset client_secret
  configured+=("$provider")
done

[ "${#configured[@]}" -eq 0 ] && { echo "Nothing to install."; exit 0; }

# Runs on the instance as root. Contains parameter names only, never values.
read -r -d '' remote <<'REMOTE' || true
set -euo pipefail
env_file=/etc/msite/msite.env
# The backup holds secrets too: owner-only, whatever the original mode.
backup="$env_file.bak-$(date -u +%Y%m%dT%H%M%SZ)"
cp -p "$env_file" "$backup"
chmod 600 "$backup"
next="$(mktemp)"
cp -p "$env_file" "$next"
for pair in GOOGLE_CLIENT_ID:google-client-id GOOGLE_CLIENT_SECRET:google-client-secret \
            MICROSOFT_CLIENT_ID:microsoft-client-id MICROSOFT_CLIENT_SECRET:microsoft-client-secret; do
  var="${pair%%:*}"
  value="$(aws ssm get-parameter --region us-east-1 --with-decryption \
    --name "/msite/finance/${pair#*:}" --query Parameter.Value --output text 2>/dev/null)" || continue
  grep -v "^${var}=" "$next" > "$next.tmp" || true
  printf '%s=%s\n' "$var" "$value" >> "$next.tmp"
  mv "$next.tmp" "$next"
  echo "set $var"
done
install -m 600 -o root -g root "$next" "$env_file"
rm -f "$next"
systemctl restart msite.service
sleep 3
systemctl is-active --quiet msite.service && echo "msite.service restarted"
REMOTE

instance_id="$(aws_cli ec2 describe-instances \
  --filters Name=tag:Project,Values=msite Name=tag:App,Values=msite-finance Name=instance-state-name,Values=running \
  --query 'Reservations[].Instances[].InstanceId' --output text)"
if [ "$DRY_RUN" = "1" ]; then
  echo "[dry run] would run on the instance:" >&2
  echo "$remote" >&2
  exit 0
fi
[ "$(wc -w <<< "$instance_id" | tr -d ' ')" = "1" ] || {
  echo "Expected exactly one running finance instance, found: $instance_id" >&2
  exit 1
}

params_file="$tmpdir/params.json"
python3 - "$remote" > "$params_file" <<'PY'
import json, sys
print(json.dumps({"commands": [sys.argv[1]]}))
PY
command_id="$(aws_cli ssm send-command --instance-ids "$instance_id" \
  --document-name AWS-RunShellScript --comment "Install msite sign-in credentials" \
  --parameters "file://$params_file" --query Command.CommandId --output text)"
aws_cli ssm wait command-executed --command-id "$command_id" --instance-id "$instance_id" || true
aws_cli ssm get-command-invocation --command-id "$command_id" --instance-id "$instance_id" \
  --query '{Status:Status,Output:StandardOutputContent,Errors:StandardErrorContent}' --output text

echo "Waiting for $SITE to offer: ${configured[*]}"
for _ in $(seq 1 30); do
  providers="$(curl -fsS "$SITE/api/auth/session" 2>/dev/null || true)"
  missing=0
  for provider in "${configured[@]}"; do
    [[ "$providers" == *"\"$provider\""* ]] || missing=1
  done
  if [ "$missing" = 0 ]; then
    echo "Live: $providers"
    echo "Done. Open $SITE and use Sign in to try it."
    exit 0
  fi
  sleep 4
done
echo "The site does not list the providers yet: $providers" >&2
exit 1
