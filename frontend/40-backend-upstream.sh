#!/bin/sh
# Writes the DNS resolver and backend address nginx.conf includes.
# BACKEND_UPSTREAM: e.g. http://backend.railway.internal:4000 on Railway
# (default http://backend:4000 matches docker compose).
set -e
NS=$(awk '/^nameserver/ {print $2; exit}' /etc/resolv.conf)
case "$NS" in *:*) NS="[$NS]";; esac
cat > /etc/nginx/backend-upstream.inc <<EOF
resolver ${NS:-127.0.0.11} valid=5s;
set \$backend_upstream "${BACKEND_UPSTREAM:-http://backend:4000}";
EOF
