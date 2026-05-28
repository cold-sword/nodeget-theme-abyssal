#!/bin/sh
set -e

HTML_DIR="/usr/share/nginx/html"
CONFIG_FILE="${HTML_DIR}/config.json"

# ── 1. NODEGET_CONFIG (完整 JSON) ──────────────────────
if [ -n "$NODEGET_CONFIG" ]; then
  echo "[entrypoint] using NODEGET_CONFIG env"
  echo "$NODEGET_CONFIG" > "$CONFIG_FILE"

# ── 2. 简化环境变量 ──────────────────────────────────
elif [ -n "$SITE_NAME" ] || [ -n "$SITE_LOGO" ] || [ -n "$SITE_FOOTER" ] || [ -n "$SITE_1" ]; then
  echo "[entrypoint] generating config from env vars"

  SITE_NAME="${SITE_NAME:-Abyssal Status}"
  SITE_LOGO="${SITE_LOGO:-}"
  SITE_FOOTER="${SITE_FOOTER:-Powered by NodeGet}"

  # 收集 SITE_1, SITE_2, ...
  TOKENS=""
  i=1
  while true; do
    eval "SITE=\$SITE_$i"
    if [ -z "$SITE" ]; then break; fi

    # 解析 key="value",key2="value2" 格式
    name=""
    backend_url=""
    token=""
    IFS=','
    for pair in $SITE; do
      key="${pair%%=*}"
      val="${pair#*=}"
      val="${val#\"}"
      val="${val%\"}"
      case "$key" in
        name) name="$val" ;;
        backend_url) backend_url="$val" ;;
        token) token="$val" ;;
      esac
    done
    unset IFS

    comma=""
    [ -n "$TOKENS" ] && comma=","
    TOKENS="${TOKENS}${comma}{\"name\":\"${name}\",\"backend_url\":\"${backend_url}\",\"token\":\"${token}\"}"
    i=$((i + 1))
  done

  # 没有 SITE_n 则用默认
  if [ -z "$TOKENS" ]; then
    TOKENS='{"name":"master server node 1","backend_url":"wss://your-backend.example.com","token":"***"}'
  fi

  cat > "$CONFIG_FILE" << JSONEOF
{
  "user_preferences": {
    "site_name": "${SITE_NAME}",
    "site_logo": "${SITE_LOGO}",
    "footer": "${SITE_FOOTER}"
  },
  "site_tokens": [
    ${TOKENS}
  ]
}
JSONEOF

  echo "[entrypoint] config.json generated"

# ── 3. 无配置 → 保持默认 ──────────────────────────────
else
  echo "[entrypoint] no config env set, using built-in defaults"
fi

# 确保 nginx 可读
chmod 644 "$CONFIG_FILE" 2>/dev/null || true

exec "$@"
