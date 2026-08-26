#!/usr/bin/env bash
# Self-signed certificates so the full stack can be run locally over HTTPS.
# Production uses Let's Encrypt — see docs/DEPLOYMENT.md.
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/certs"
mkdir -p "$DIR"

openssl req -x509 -nodes -newkey rsa:2048 -days 365 \
  -keyout "$DIR/privkey.pem" \
  -out "$DIR/fullchain.pem" \
  -subj "/C=IN/ST=Tamil Nadu/L=Coimbatore/O=Sakha InfoTech/CN=sakhaai.com" \
  -addext "subjectAltName=DNS:sakhaai.com,DNS:www.sakhaai.com,DNS:localhost,IP:127.0.0.1" \
  2>/dev/null

chmod 600 "$DIR/privkey.pem"
echo "✓ Development certificates written to $DIR"
echo "  Browsers will warn about these. That is expected — they are self-signed."
