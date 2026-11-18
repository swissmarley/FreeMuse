#!/bin/sh
# Load generated secrets (from the one-shot "keys" service) without overriding anything set explicitly.
if [ -f /secrets/keys.env ]; then
  while IFS='=' read -r k v; do
    [ -z "$k" ] && continue
    eval "cur=\${$k:-}"
    [ -z "$cur" ] && export "$k=$v"
  done < /secrets/keys.env
fi
exec "$@"
